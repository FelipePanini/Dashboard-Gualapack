// ============================================================================
// sync.js — carga diária dos dados reais de produção
// ----------------------------------------------------------------------------
// Roda como cron job no VPS Hostinger (ver README-vps.md). Faz três coisas:
//
//   1. Lê os CSVs mais recentes de uma pasta do Google Drive (exports diários
//      dos BIs + planilhas manuais, tudo na mesma pasta combinada).
//   2. Valida e transforma cada linha (tipos numéricos, datas).
//   3. Upsert nas tabelas do Supabase Postgres (backend/schema_data.sql),
//      usando a service_role key — grava mesmo com RLS ativo.
//
// Cada arquivo CSV precisa ter cabeçalho com os nomes de coluna da tabela de
// destino (mesmo nome). Se um export vier com nomes diferentes, ajuste o
// mapeamento em COLUMN_MAP abaixo em vez de pedir pra mudar o export.
// ============================================================================

import "dotenv/config";
import fs from "node:fs";
import { google } from "googleapis";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

// sync.js — carga diária dos dados reais de produção
// Roda agendado pelo GitHub Actions (.github/workflows/sync-daily.yml).
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SYNC_DRIVE_FOLDER_ID"];
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

function authGoogleDrive() {
  // Aceita a chave de duas formas: caminho pra um arquivo (uso local) ou o
  // JSON inteiro numa variável de ambiente (uso no GitHub Actions, onde o
  // conteúdo vem de um Secret e é escrito num arquivo temporário pelo workflow).
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined;

  const auth = new google.auth.GoogleAuth({
    credentials,
    keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

async function listDriveFiles(drive) {
  const res = await drive.files.list({
    q: `'${process.env.SYNC_DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id, name, modifiedTime)",
    pageSize: 100,
  });
  const map = {};
  for (const f of res.data.files ?? []) map[f.name] = f.id;
  return map;
}

async function downloadDriveFile(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  return res.data;
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
    const drive = authGoogleDrive();
    const files = await listDriveFiles(drive);

    for (const [fileName, cfg] of Object.entries(FILE_MAP)) {
      const fileId = files[fileName];
      if (!fileId) {
        console.log(`[skip] ${fileName} não encontrado na pasta hoje.`);
        continue;
      }

      const csvText = await downloadDriveFile(drive, fileId);
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
