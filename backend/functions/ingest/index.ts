// ============================================================================
// ingest — recebe a carga diária mandada pelo Power Automate
// ----------------------------------------------------------------------------
// O Power Automate lê as planilhas (rodando com o login do próprio usuário,
// sem precisar de app registrado nem admin consent) e chama esta função uma
// vez para cada tabela, mandando as linhas já em JSON.
//
// Corpo esperado (POST):
//   {
//     "table": "maquinas_diario",
//     "rows": [ { "data_ref": "2026-08-31", "maquina_id": "REB01", ... }, ... ]
//   }
//
// Autenticação: um segredo simples no header "x-ingest-secret", comparado
// com o secret INGEST_SHARED_SECRET configurado nesta função. Só quem tem o
// segredo consegue gravar — é o suficiente aqui porque quem chama é sempre o
// mesmo flow do Power Automate, nunca o navegador do usuário final.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_TABLES = new Set([
  "maquinas_diario",
  "perdas_diario",
  "ops_diario",
  "wip_diario",
  "carteira_diario",
  "apontamentos",
]);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = req.headers.get("x-ingest-secret");
  if (!secret || secret !== Deno.env.get("INGEST_SHARED_SECRET")) {
    return new Response(JSON.stringify({ ok: false, error: "não autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: logRow } = await supabase.from("sync_log").insert({ status: "running" }).select("id").single();

  try {
    const body = await req.json();
    const table = body.table as string;
    const rows = body.rows as Record<string, unknown>[];

    if (!ALLOWED_TABLES.has(table)) throw new Error(`Tabela não permitida: ${table}`);
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Nenhuma linha enviada.");

    // upsert em lotes de 500 pra não estourar o payload
    let gravadas = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from(table).upsert(chunk);
      if (error) throw new Error(`Erro gravando em ${table}: ${error.message}`);
      gravadas += chunk.length;
    }

    await supabase
      .from("sync_log")
      .update({ status: "ok", finished_at: new Date().toISOString(), linhas_gravadas: gravadas, detalhe: table })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: true, table, linhas: gravadas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await supabase
      .from("sync_log")
      .update({ status: "error", finished_at: new Date().toISOString(), detalhe: String(err) })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
