// ============================================================================
// build-database-central.js — monta o DATABASE_GUALAPACK.xlsx a partir das
// bases reais e grava (cria ou atualiza) esse arquivo na mesma pasta do
// Google Drive.
// ----------------------------------------------------------------------------
// Arquitetura (decidida com o usuário em 2026-09-09):
//
//   BASES ORIGINAIS (Drive)
//         |
//   ESTE SCRIPT — lê os originais, normaliza, escreve as abas DB_
//         |
//   DATABASE_GUALAPACK.xlsx (Drive) <- fica sendo o retrato fiel e atualizado
//         |
//   sync.js — (nesta fase ainda lê os originais direto; o corte pra ler só
//              o arquivo central é o próximo incremento, depois de validar
//              que este arquivo sai correto)
//         |
//   SUPABASE
//
// Cobre só as abas já validadas na Etapa 2/3 da conversa com o usuário:
// DB_APONTAMENTOS, DB_PRODUCAO_KG, DB_FARDOS_APARAS, DB_REFUGO_APARAS,
// DB_REFUGO_PRODUCAO, DB_TENDENCIA, DB_MAQUINAS. NÃO inclui DB_TMR nem
// DB_ADERENCIA ainda — dependem de confirmar a aba/chave real (Fases 2 e 3
// do plano combinado), ver DB_CONTROLE pra aviso disso a cada execução.
//
// Roda toda vez do zero (não é incremental) — é só um espelho consolidado
// pra leitura, não substitui a lógica de INSERT/UPDATE/IGNORAR, que fica na
// carga do Supabase (sync.js).
// ============================================================================

import * as XLSX from "xlsx";
import { Readable } from "node:stream";
import {
  TABLE_DEFS, RETENTION_MONTHS, RETENTION_DATE_COL, DEDUPE_KEY,
  dedupeRows, detectTables, detectSheet, sheetToRows, coerceRow,
  driveClient, listFolderFiles, downloadFile, CENTRAL_FILE_NAME, DB_SHEET_NAME,
} from "./lib.js";

const required = ["DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const PENDENTES = [
  "DB_TMR (Gráficos Tendência.xlsx, abas TMR-*) — aguardando confirmar chave/granularidade mista (máquina x processo).",
  "DB_ADERENCIA (Aderência Semanal.xlsx, aba ADERÊNCIA DIÁRIA) — aguardando confirmar chave única contra os dados reais.",
];

async function collectTableRows(drive, files) {
  // tabela -> { rows: [...], arquivos: Set, erros: [] }
  const porTabela = new Map();
  const touch = (table) => {
    if (!porTabela.has(table)) porTabela.set(table, { rows: [], arquivos: new Set(), erros: [] });
    return porTabela.get(table);
  };

  for (const file of files) {
    const defs = detectTables(file.name);
    if (defs.length === 0 || !defs.some((d) => DB_SHEET_NAME[d.table])) continue;

    let bytes;
    try {
      bytes = await downloadFile(drive, file);
    } catch (err) {
      for (const def of defs) if (DB_SHEET_NAME[def.table]) touch(def.table).erros.push(`${file.name}: falha ao baixar (${err.message})`);
      continue;
    }
    const sheetNames = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;

    for (const def of defs) {
      if (!DB_SHEET_NAME[def.table]) continue; // aba ainda não validada (DB_TMR, DB_ADERENCIA) — pula
      const bucket = touch(def.table);
      try {
        const sheetName = detectSheet(def, sheetNames);
        const workbook = XLSX.read(bytes, { type: "array", sheets: [sheetName] });
        const rawRows = sheetToRows(workbook.Sheets[sheetName]);
        if (rawRows.length === 0) continue;

        let rows = rawRows.map((r) => coerceRow(r, def.numeric, def.date, def.allowed));
        if (rows.every((r) => Object.keys(r).length === 0)) {
          bucket.erros.push(`${file.name} [${sheetName}]: nenhuma coluna bateu com o esperado.`);
          continue;
        }

        const keyCols = DEDUPE_KEY[def.table];
        if (keyCols) {
          const cols = keyCols.split(",");
          rows = rows.filter((r) => cols.every((c) => r[c] !== null && r[c] !== undefined));
        }
        if (rows.length === 0) continue;

        const retentionCol = RETENTION_DATE_COL[def.table];
        if (retentionCol) {
          const cutoff = new Date();
          cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
          rows = rows.filter((r) => r[retentionCol] && new Date(r[retentionCol]) >= cutoff);
        }
        if (rows.length === 0) continue;

        bucket.rows.push(...rows.map((r) => ({ ...r, _source_file: file.name })));
        bucket.arquivos.add(file.name);
        console.log(`[ok] "${file.name}" [${sheetName}] -> ${DB_SHEET_NAME[def.table]}: ${rows.length} linhas`);
      } catch (err) {
        bucket.erros.push(`${file.name}: ${err.message}`);
        console.error(`[erro] "${file.name}" -> ${def.table}:`, err.message);
      }
    }
  }

  // dedup final pras tabelas com chave natural (maquinas, tendencia_mensal,
  // refugo_aparas_historico) — pode ter vindo de mais de um arquivo/aba.
  for (const [table, bucket] of porTabela) {
    const keyCols = DEDUPE_KEY[table];
    if (keyCols) bucket.rows = dedupeRows(bucket.rows, keyCols);
  }
  return porTabela;
}

function buildWorkbook(porTabela) {
  const wb = XLSX.utils.book_new();

  for (const def of TABLE_DEFS) {
    const sheetName = DB_SHEET_NAME[def.table];
    if (!sheetName) continue;
    const bucket = porTabela.get(def.table) ?? { rows: [], arquivos: new Set() };
    // ordem de coluna estável = a mesma ordem de "allowed" no TABLE_DEFS,
    // mais _source_file no fim (controle, não é dado de negócio).
    const header = [...def.allowed, "_source_file"];
    const ws = XLSX.utils.json_to_sheet(bucket.rows, { header });
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const agora = new Date().toISOString();
  const controleRows = TABLE_DEFS
    .filter((def) => DB_SHEET_NAME[def.table])
    .map((def) => {
      const bucket = porTabela.get(def.table) ?? { rows: [], arquivos: new Set(), erros: [] };
      return {
        aba: DB_SHEET_NAME[def.table],
        registros: bucket.rows.length,
        arquivos_origem: Array.from(bucket.arquivos).join(" | ") || "(nenhum arquivo encontrado)",
        ultima_execucao: agora,
        status: bucket.erros.length ? "erro" : bucket.rows.length ? "ok" : "vazio",
        observacao: bucket.erros.join(" ; "),
      };
    });
  controleRows.push(
    ...PENDENTES.map((texto) => ({
      aba: texto.split(" ")[0], registros: 0, arquivos_origem: "", ultima_execucao: agora,
      status: "pendente", observacao: texto,
    }))
  );
  const wsControle = XLSX.utils.json_to_sheet(controleRows, {
    header: ["aba", "registros", "arquivos_origem", "ultima_execucao", "status", "observacao"],
  });
  XLSX.utils.book_append_sheet(wb, wsControle, "DB_CONTROLE");

  return wb;
}

async function findExistingCentralFile(drive) {
  const res = await drive.files.list({
    q: `'${process.env.DRIVE_FOLDER_ID}' in parents and trashed = false and name = '${CENTRAL_FILE_NAME}'`,
    fields: "files(id, name, mimeType)",
    pageSize: 5,
  });
  return res.data.files?.[0] ?? null;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function uploadCentralFile(drive, buffer) {
  const media = { mimeType: XLSX_MIME, body: Readable.from(buffer) };
  const existing = await findExistingCentralFile(drive);
  if (existing) {
    // Se o placeholder foi criado como Planilha Google (não .xlsx de
    // verdade), o update precisa trocar o mimeType junto com o conteúdo,
    // senão o Drive tenta converter o binário pro formato nativo e corrompe
    // o arquivo. Só entra nesse "if" na primeira vez — depois que vira
    // .xlsx de fato, mimeType já bate e o Drive ignora o campo.
    const requestBody = existing.mimeType !== XLSX_MIME ? { mimeType: XLSX_MIME } : undefined;
    await drive.files.update({ fileId: existing.id, media, requestBody });
    console.log(`"${CENTRAL_FILE_NAME}" atualizado (id ${existing.id}).`);
  } else {
    await drive.files.create({
      requestBody: { name: CENTRAL_FILE_NAME, parents: [process.env.DRIVE_FOLDER_ID] },
      media,
      fields: "id",
    });
    console.log(`"${CENTRAL_FILE_NAME}" criado.`);
  }
}

async function main() {
  // Escrever no Drive precisa de escopo de leitura+escrita — diferente do
  // sync.js, que só lê. A conta de serviço precisa ter permissão de Editor
  // na pasta (não só Leitor), senão files.create/update falha com 403.
  const drive = driveClient(["https://www.googleapis.com/auth/drive"]);
  const files = await listFolderFiles(drive);
  console.log(`${files.length} arquivo(s) na pasta do Drive.`);

  const porTabela = await collectTableRows(drive, files);
  const wb = buildWorkbook(porTabela);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  console.log(`Arquivo central montado em memória: ${(buffer.length / 1024 / 1024).toFixed(1)} MB.`);

  await uploadCentralFile(drive, buffer);

  console.log("\nResumo:");
  for (const [table, bucket] of porTabela) {
    console.log(`  ${DB_SHEET_NAME[table]}: ${bucket.rows.length} linhas de ${bucket.arquivos.size} arquivo(s)${bucket.erros.length ? ` — ${bucket.erros.length} erro(s)` : ""}`);
  }
  if (PENDENTES.length) {
    console.log("\nAbas ainda não incluídas (pendentes de validação):");
    for (const p of PENDENTES) console.log(`  - ${p}`);
  }
}

main().catch((err) => {
  console.error("Falha ao montar o arquivo central:", err);
  process.exit(1);
});
