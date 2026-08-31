// ============================================================================
// ingest — recebe planilhas enviadas pela tela demo/upload.html
// ----------------------------------------------------------------------------
// Chamada direto do navegador (client.functions.invoke), com a sessão do
// usuário logado — não usa mais senha compartilhada. Em vez disso, verifica
// que quem está chamando é um usuário autenticado com role = 'admin' na
// tabela profiles, igual às funções admin_* já usadas em demo/admin.html.
//
// Corpo esperado (POST):
//   {
//     "table": "maquinas_diario",
//     "fileName": "Máquinas Diário.xlsx",   // só pra log, não decide nada
//     "contentBase64": "<arquivo inteiro em base64>"
//   }
//
// Faz o parse do Excel/CSV sozinha (SheetJS) e faz upsert na tabela indicada.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const ALLOWED_TABLES = new Set([
  "maquinas_diario",
  "perdas_diario",
  "ops_diario",
  "wip_diario",
  "carteira_diario",
  "apontamentos",
]);

// Colunas que devem ser convertidas de texto pra número em cada tabela —
// tudo que não estiver aqui fica como veio (texto).
const NUMERIC_COLUMNS: Record<string, string[]> = {
  maquinas_diario: ["tmr", "vel_media", "aparas_pct", "perda_confirm_pct", "horas_prod", "horas_tot", "plan_km", "real_km"],
  perdas_diario: ["kg"],
  ops_diario: ["peso_bruto_kg", "refugo_kg", "apara_pct"],
  wip_diario: ["metros"],
  carteira_diario: ["carteira_kg", "produzido_kg", "faturado_kg"],
  apontamentos: [],
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeHeader(name: string): string {
  return String(name)
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function coerceRow(row: Record<string, unknown>, numericCols: string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const col = normalizeHeader(key);
    if (value === "" || value === undefined || value === null) {
      out[col] = null;
    } else if (numericCols.includes(col)) {
      out[col] = Number(value);
    } else {
      out[col] = value;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 1. Confirma que quem chamou é um usuário logado e com role = admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ ok: false, error: "não autenticado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ ok: false, error: "sessão inválida" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ ok: false, error: "restrito a administradores" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Faz o parse da planilha e grava.
  const { data: logRow } = await supabase.from("sync_log").insert({ status: "running" }).select("id").single();

  try {
    const body = await req.json();
    const table = body.table as string;
    const fileName = (body.fileName as string) ?? "arquivo";
    const contentBase64 = body.contentBase64 as string;

    if (!ALLOWED_TABLES.has(table)) throw new Error(`Tabela não permitida: ${table}`);
    if (!contentBase64) throw new Error("Nenhum arquivo enviado.");

    const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
    const workbook = XLSX.read(bytes, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

    if (rawRows.length === 0) throw new Error(`"${fileName}" está vazio.`);

    const numericCols = NUMERIC_COLUMNS[table] ?? [];
    const rows = rawRows.map((r) => coerceRow(r, numericCols));

    let gravadas = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from(table).upsert(chunk);
      if (error) throw new Error(`Erro gravando em ${table}: ${error.message}`);
      gravadas += chunk.length;
    }

    await supabase
      .from("sync_log")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        linhas_gravadas: gravadas,
        detalhe: `${fileName} -> ${table} (por ${userData.user.email})`,
      })
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
