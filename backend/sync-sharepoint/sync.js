// ============================================================================
// sync.js — carga diária automática via Microsoft Graph API (SharePoint)
// ----------------------------------------------------------------------------
// PRÉ-MONTADO, AINDA INATIVO — depende do app registrado no Entra ID que a
// TI precisa liberar (ver "Ativar a sincronização automática" em
// backend/README-dados.md). Enquanto isso não acontece, o fluxo real é o
// upload manual por demo/upload.html — este script não roda em produção.
//
// Uma vez com os 3 secrets (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET)
// configurados no GitHub e o app com a permissão Sites.Read.All concedida,
// o workflow .github/workflows/sync-sharepoint.yml passa a rodar isso todo
// dia sozinho — sem precisar mais abrir upload.html.
//
// Mesma lógica de detecção de tabela/aba de demo/upload.html e
// backend/functions/ingest/index.ts — se o mapeamento de colunas mudar lá,
// espelhe aqui também.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const required = [
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET",
  "SHAREPOINT_SITE", "SHAREPOINT_FOLDER_PATH",
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Tabela -> palavras-chave no nome do arquivo, palavras-chave na aba, e
// colunas numéricas. Espelha TABLES em demo/upload.html.
const TABLE_DEFS = [
  { table: "fardos_aparas", fileKeywords: ["sequenciamento"], sheetKeywords: ["completos", "base_aparas_total"], numeric: ["numero", "qtd_bruta_kg", "qtd_liquida_kg"] },
  { table: "aderencia_maquinas_diaria", fileKeywords: ["aderencia_maquinas", "aderenciamaquinas"], sheetKeywords: ["apontamentos_producao"], numeric: ["qtd_produzida", "qtd_horas"] },
  { table: "aderencia_programacao", fileKeywords: ["historico_aderencia", "aderencia_programacao"], sheetKeywords: ["programacao_passado"], numeric: ["qtd_produzido", "qtd_planejado", "meta_qtd_acerto", "qtd_acerto_real", "min_set_prog", "min_set_real", "qtd_prod_kg", "meta_mts_hora", "qtd_hor_p"] },
  { table: "refugo_aparas_historico", fileKeywords: ["refugo_aparas"], sheetKeywords: ["historico_refugo"], numeric: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"] },
  { table: "tendencia_mensal", fileKeywords: ["tendencia", "grafico"], sheetKeywords: ["dados_prod"], numeric: ["ano", "volume_prod_corte_km", "lote_medio_km", "volume_prod_kg", "aparas_kg", "aparas_pct"] },
  { table: "maquinas", fileKeywords: ["machine_card"], sheetKeywords: ["dim_eqtos"], numeric: [] },
  { table: "apontamentos", fileKeywords: ["indicadores", "base_aparas"], sheetKeywords: ["base_maquina", "base_detalhe"], numeric: ["qtd_horas", "qtd_produzida", "desperdicio_acerto", "desperdicio_virando", "peso_bruto_bobina", "kg_perda"] },
];

const CONFLICT_COLUMNS = { refugo_aparas_historico: "data", tendencia_mensal: "mes,ano" };

function normalize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.(xlsx|xls|csv)$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function detectTable(fileName) {
  const norm = normalize(fileName);
  return TABLE_DEFS.find((t) => t.fileKeywords.some((k) => norm.includes(k))) ?? null;
}

function detectSheet(def, sheetNames) {
  return sheetNames.find((n) => def.sheetKeywords.some((k) => normalize(n).includes(k))) ?? sheetNames[0];
}

function coerceRow(row, numericCols) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const col = normalize(key);
    if (value === "" || value === undefined || value === null) out[col] = null;
    else if (numericCols.includes(col)) out[col] = Number(value);
    else out[col] = value;
  }
  return out;
}

async function getGraphToken() {
  const url = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Falha ao autenticar no Microsoft Graph: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function getSiteId(token) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${process.env.SHAREPOINT_SITE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.id) throw new Error(`Não encontrei o site do SharePoint: ${JSON.stringify(json)}`);
  return json.id;
}

async function listFolderFiles(token, siteId) {
  const path = process.env.SHAREPOINT_FOLDER_PATH;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI(path)}:/children`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = await res.json();
  if (!json.value) throw new Error(`Não consegui listar a pasta do SharePoint: ${JSON.stringify(json)}`);
  return json.value; // [{ id, name }, ...]
}

async function downloadFile(token, siteId, itemId) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return new Uint8Array(await res.arrayBuffer());
}

async function logStart() {
  const { data, error } = await supabase.from("sync_log").insert({ status: "running" }).select("id").single();
  if (error) throw new Error(`Não consegui abrir o log de carga: ${error.message}`);
  return data.id;
}
async function logFinish(id, status, detalhe, linhas) {
  await supabase.from("sync_log").update({ status, finished_at: new Date().toISOString(), detalhe, linhas_gravadas: linhas }).eq("id", id);
}

async function main() {
  const logId = await logStart();
  let totalLinhas = 0;

  try {
    const token = await getGraphToken();
    const siteId = await getSiteId(token);
    const files = await listFolderFiles(token, siteId);

    for (const file of files) {
      const def = detectTable(file.name);
      if (!def) {
        console.log(`[skip] "${file.name}" não bate com nenhuma tabela conhecida.`);
        continue;
      }

      const bytes = await downloadFile(token, siteId, file.id);
      const workbook = XLSX.read(bytes, { type: "array" });
      const sheetName = detectSheet(def, workbook.SheetNames);
      const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      if (rawRows.length === 0) {
        console.log(`[skip] "${file.name}" [${sheetName}] está vazia.`);
        continue;
      }

      const rows = rawRows.map((r) => coerceRow(r, def.numeric));
      const conflictCols = CONFLICT_COLUMNS[def.table];

      let gravadas = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = conflictCols
          ? await supabase.from(def.table).upsert(chunk, { onConflict: conflictCols })
          : await supabase.from(def.table).upsert(chunk);
        if (error) throw new Error(`Erro gravando em ${def.table} (${file.name}): ${error.message}`);
        gravadas += chunk.length;
      }

      console.log(`[ok] "${file.name}" [${sheetName}] -> ${def.table}: ${gravadas} linhas`);
      totalLinhas += gravadas;
    }

    await logFinish(logId, "ok", "sync automático (GitHub Actions)", totalLinhas);
    console.log(`Carga concluída: ${totalLinhas} linhas no total.`);
  } catch (err) {
    console.error("Carga falhou:", err);
    await logFinish(logId, "error", String(err?.message ?? err), totalLinhas);
    process.exit(1);
  }
}

main();
