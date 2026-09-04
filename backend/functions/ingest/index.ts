// ============================================================================
// ingest — recebe planilhas reais enviadas pela tela demo/upload.html
// ----------------------------------------------------------------------------
// Chamada direto do navegador (client.functions.invoke), com a sessão do
// usuário logado. Verifica que quem chama é admin (role = 'admin' em
// profiles), depois faz o parse da aba enviada (SheetJS) e upsert na tabela
// escolhida — ver backend/README-dados.md pro mapeamento planilha -> tabela.
//
// Corpo esperado (POST):
//   {
//     "table": "apontamentos",
//     "fileName": "Indicadores Diário - 2026.xlsx",
//     "sheetName": "Base Máquina_Embalagem",   // opcional — várias abas
//     "contentBase64": "<arquivo (ou a aba já cortada) em base64>"
//   }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

// Tabela -> colunas que devem virar número (o resto fica como veio: texto).
const NUMERIC_COLUMNS: Record<string, string[]> = {
  maquinas: [],
  apontamentos: [
    "qtd_horas", "qtd_produzida", "desperdicio_acerto", "desperdicio_virando",
    "peso_bruto_bobina", "kg_perda",
  ],
  fardos_aparas: ["numero", "qtd_bruta_kg", "qtd_liquida_kg"],
  aderencia_maquinas_diaria: ["qtd_produzida", "qtd_horas"],
  aderencia_programacao: [
    "qtd_produzido", "qtd_planejado", "meta_qtd_acerto", "qtd_acerto_real",
    "min_set_prog", "min_set_real", "qtd_prod_kg", "meta_mts_hora", "qtd_hor_p",
  ],
  refugo_aparas_historico: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"],
  tendencia_mensal: ["ano", "volume_prod_corte_km", "lote_medio_km", "volume_prod_kg", "aparas_kg", "aparas_pct"],
};

// Tabelas com chave natural (não a "id" gerada) usam onConflict pra virar
// upsert de verdade — sem isso, reenviar o mesmo mês/dia duplicaria linhas.
const CONFLICT_COLUMNS: Record<string, string> = {
  refugo_aparas_historico: "data",
  tendencia_mensal: "mes,ano",
};

const ALLOWED_TABLES = new Set(Object.keys(NUMERIC_COLUMNS));

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cabeçalhos reais vêm em "CamelCase" grudado (ex: "CodApont", "NumOrdem"),
// sem espaço nem underscore separando as palavras — por isso insere "_"
// entre uma letra minúscula/número e a maiúscula seguinte ANTES de baixar
// pra minúsculo, senão "CodApont" viraria "codapont" em vez de "cod_apont".
function normalizeHeader(name: string): string {
  return String(name)
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Colunas cujo nome real na planilha não bate nem depois de normalizar
// (prefixo "usr_" do sistema de origem, abreviações diferentes etc.) —
// mapeadas manualmente pro nome que usamos no banco.
const HEADER_ALIASES: Record<string, string> = {
  usr_tipodaperda: "tipo_perda",
  usr_kgdaperda: "kg_perda",
  usr_peso_bruto_bobina: "peso_bruto_bobina",
};

function coerceRow(row: Record<string, unknown>, numericCols: string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    const col = HEADER_ALIASES[normalized] ?? normalized;
    if (value === "" || value === undefined || value === null) {
      out[col] = null;
    } else if (numericCols.includes(col)) {
      const n = Number(String(value).replace(/\./g, "").replace(",", "."));
      out[col] = Number.isNaN(n) ? Number(value) : n;
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
    const sheetName = body.sheetName as string | undefined;

    if (!ALLOWED_TABLES.has(table)) throw new Error(`Tabela não permitida: ${table}`);
    if (!contentBase64) throw new Error("Nenhum arquivo enviado.");

    const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
    const workbook = XLSX.read(bytes, { type: "array" });
    const targetSheet = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
    const sheet = workbook.Sheets[targetSheet];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rawRows.length === 0) throw new Error(`"${fileName}" (aba "${targetSheet}") está vazia.`);

    const numericCols = NUMERIC_COLUMNS[table] ?? [];
    const rows = rawRows.map((r) => coerceRow(r, numericCols));
    const conflictCols = CONFLICT_COLUMNS[table];

    let gravadas = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = conflictCols
        ? await supabase.from(table).upsert(chunk, { onConflict: conflictCols })
        : await supabase.from(table).upsert(chunk);
      if (error) throw new Error(`Erro gravando em ${table}: ${error.message}`);
      gravadas += chunk.length;
    }

    await supabase
      .from("sync_log")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        linhas_gravadas: gravadas,
        detalhe: `${fileName} [${targetSheet}] -> ${table} (por ${userData.user.email})`,
      })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: true, table, sheet: targetSheet, linhas: gravadas }), {
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
