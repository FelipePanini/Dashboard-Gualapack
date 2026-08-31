// ============================================================================
// ingest — recebe qualquer planilha da pasta e grava no banco sozinha
// ----------------------------------------------------------------------------
// Um único flow no Power Automate observa a pasta inteira no SharePoint e,
// pra qualquer arquivo criado/alterado, manda o conteúdo bruto pra cá — sem
// precisar transformar a planilha em Tabela nem configurar bloco por bloco.
//
// Corpo esperado (POST):
//   {
//     "fileName": "Máquinas diário.xlsx",
//     "contentBase64": "<arquivo inteiro em base64>"
//   }
//
// Esta função:
//   1. Identifica a tabela de destino pelo nome do arquivo (FILE_MAP).
//   2. Faz o parse do Excel/CSV sozinha (usando SheetJS) — não depende de o
//      Power Automate entender a estrutura da planilha.
//   3. Converte texto -> número nas colunas certas e faz upsert no Supabase.
//
// Autenticação: header "x-ingest-secret", comparado com o secret
// INGEST_SHARED_SECRET configurado nesta função.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

// Nome do arquivo esperado na pasta (comparação sem acento/maiúscula, então
// "Máquinas diário.xlsx" e "maquinas_diario.xlsx" batem com a mesma entrada)
// -> tabela de destino + colunas numéricas.
const FILE_MAP: Record<string, { table: string; numeric: string[] }> = {
  "maquinas_diario": {
    table: "maquinas_diario",
    numeric: ["tmr", "vel_media", "aparas_pct", "perda_confirm_pct", "horas_prod", "horas_tot", "plan_km", "real_km"],
  },
  "perdas_diario": { table: "perdas_diario", numeric: ["kg"] },
  "ops_diario": { table: "ops_diario", numeric: ["peso_bruto_kg", "refugo_kg", "apara_pct"] },
  "wip_diario": { table: "wip_diario", numeric: ["metros"] },
  "carteira_diario": { table: "carteira_diario", numeric: ["carteira_kg", "produzido_kg", "faturado_kg"] },
  "apontamentos": { table: "apontamentos", numeric: [] },
};

function normalizeFileName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/\.(xlsx|xls|csv)$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findMapping(fileName: string) {
  const norm = normalizeFileName(fileName);
  for (const [key, cfg] of Object.entries(FILE_MAP)) {
    if (norm.includes(key)) return cfg;
  }
  return null;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-secret",
};

function coerceRow(row: Record<string, unknown>, numericCols: string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    // normaliza cabeçalho da planilha pro nome de coluna do banco:
    // "TMR (%)" -> "tmr", "Vel. Média" -> "vel_media" etc.
    const col = normalizeFileName(String(key));
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
    const fileName = body.fileName as string;
    const contentBase64 = body.contentBase64 as string;

    if (!fileName || !contentBase64) throw new Error("fileName e contentBase64 são obrigatórios.");

    const mapping = findMapping(fileName);
    if (!mapping) throw new Error(`Nenhuma tabela conhecida bate com o arquivo "${fileName}" — ignorado.`);

    const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
    const workbook = XLSX.read(bytes, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

    if (rawRows.length === 0) throw new Error(`"${fileName}" está vazio.`);

    const rows = rawRows.map((r) => coerceRow(r, mapping.numeric));

    let gravadas = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from(mapping.table).upsert(chunk);
      if (error) throw new Error(`Erro gravando em ${mapping.table}: ${error.message}`);
      gravadas += chunk.length;
    }

    await supabase
      .from("sync_log")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        linhas_gravadas: gravadas,
        detalhe: `${fileName} -> ${mapping.table}`,
      })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: true, table: mapping.table, linhas: gravadas }), {
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
