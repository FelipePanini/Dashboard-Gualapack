// ============================================================================
// sync.js — carga diária dos dados reais de produção
// ----------------------------------------------------------------------------
// Roda agendado pelo GitHub Actions (.github/workflows/sync-daily.yml). Faz
// três coisas:
//
//   1. Lê os CSVs mais recentes de uma pasta do SharePoint/OneDrive (exports
//      diários dos BIs + planilhas manuais, tudo na mesma pasta combinada),
//      via Microsoft Graph API.
//   2. Valida e transforma cada linha (tipos numéricos).
//   3. Upsert nas tabelas do Supabase Postgres (backend/schema_data.sql),
//      usando a service_role key — grava mesmo com RLS ativo.
//
// Cada arquivo CSV precisa ter cabeçalho com os nomes de coluna da tabela de
// destino (mesmo nome). Se um export vier com nomes diferentes, ajuste o
// mapeamento em FILE_MAP abaixo em vez de pedir pra mudar o export.
// ============================================================================

import "dotenv/config";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MS_TENANT_ID",
  "MS_CLIENT_ID",
  "MS_CLIENT_SECRET",
  "SHAREPOINT_SITE",
  "SHAREPOINT_FOLDER_PATH",
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key} (veja .env.example)`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Nome do arquivo esperado na pasta -> tabela de destino + colunas numéricas
// (o CSV chega tudo como texto; essas colunas são convertidas para number).
const FILE_MAP = {
  "maquinas_diario.csv": {
    table: "maquinas_diario",
    numeric: ["tmr", "vel_media", "aparas_pct", "perda_confirm_pct", "horas_prod", "horas_tot", "plan_km", "real_km"],
  },
  "perdas_diario.csv": { table: "perdas_diario", numeric: ["kg"] },
  "ops_diario.csv": { table: "ops_diario", numeric: ["peso_bruto_kg", "refugo_kg", "apara_pct"] },
  "wip_diario.csv": { table: "wip_diario", numeric: ["metros"] },
  "carteira_diario.csv": { table: "carteira_diario", numeric: ["carteira_kg", "produzido_kg", "faturado_kg"] },
  "apontamentos.csv": { table: "apontamentos", numeric: [] },
};

// ----------------------------------------------------------------------------
// Autenticação Microsoft Graph — fluxo "client credentials" (app-only), sem
// nenhum usuário logando: o app registrado no Entra ID recebe permissão de
// leitura no site do SharePoint e busca os arquivos sozinho.
// ----------------------------------------------------------------------------
async function getGraphToken() {
  const url = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Falha ao autenticar no Microsoft Graph: ${JSON.stringify(json)}`);
  return json.access_token;
}

// SHAREPOINT_SITE no formato "gualapackspa.sharepoint.com:/personal/felipe_panini_gualapack_com"
// (o Graph identifica sites por hostname + caminho, não pela URL de compartilhamento).
async function getSiteId(token) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${process.env.SHAREPOINT_SITE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.id) throw new Error(`Não encontrei o site do SharePoint: ${JSON.stringify(json)}`);
  return json.id;
}

async function listFolderFiles(token, siteId) {
  const path = process.env.SHAREPOINT_FOLDER_PATH; // ex: "Documentos Compartilhados/Painel Produção"
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI(path)}:/children`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = await res.json();
  if (!json.value) throw new Error(`Não consegui listar a pasta do SharePoint: ${JSON.stringify(json)}`);
  const map = {};
  for (const f of json.value) map[f.name] = f.id;
  return map;
}

async function downloadFile(token, siteId, itemId) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await res.text();
}

function coerceRow(row, numericCols) {
  const out = { ...row };
  for (const col of numericCols) {
    if (out[col] === "" || out[col] === undefined) delete out[col];
    else out[col] = Number(out[col]);
  }
  // strings vazias viram null em vez de "" (evita sujar colunas opcionais)
  for (const key of Object.keys(out)) {
    if (out[key] === "") out[key] = null;
  }
  return out;
}

async function logStart() {
  const { data, error } = await supabase.from("sync_log").insert({ status: "running" }).select("id").single();
  if (error) throw new Error(`Não consegui abrir o log de carga: ${error.message}`);
  return data.id;
}

async function logFinish(id, status, detalhe, linhas) {
  await supabase
    .from("sync_log")
    .update({ status, finished_at: new Date().toISOString(), detalhe, linhas_gravadas: linhas })
    .eq("id", id);
}

async function main() {
  const logId = await logStart();
  let totalLinhas = 0;

  try {
    const token = await getGraphToken();
    const siteId = await getSiteId(token);
    const files = await listFolderFiles(token, siteId);

    for (const [fileName, cfg] of Object.entries(FILE_MAP)) {
      const itemId = files[fileName];
      if (!itemId) {
        console.log(`[skip] ${fileName} não encontrado na pasta hoje.`);
        continue;
      }

      const csvText = await downloadFile(token, siteId, itemId);
      const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
      if (rows.length === 0) {
        console.log(`[skip] ${fileName} está vazio.`);
        continue;
      }

      const coerced = rows.map((r) => coerceRow(r, cfg.numeric));

      // upsert em lotes de 500 pra não estourar o payload
      for (let i = 0; i < coerced.length; i += 500) {
        const chunk = coerced.slice(i, i + 500);
        const { error } = await supabase.from(cfg.table).upsert(chunk);
        if (error) throw new Error(`Erro gravando em ${cfg.table} (${fileName}): ${error.message}`);
      }

      console.log(`[ok] ${fileName} -> ${cfg.table}: ${rows.length} linhas`);
      totalLinhas += rows.length;
    }

    await logFinish(logId, "ok", null, totalLinhas);
    console.log(`Carga concluída: ${totalLinhas} linhas no total.`);
  } catch (err) {
    console.error("Carga falhou:", err);
    await logFinish(logId, "error", String(err?.message ?? err), totalLinhas);
    process.exit(1);
  }
}

main();
