// ============================================================================
// sync.js — carga diária automática via Google Drive (conta pessoal)
// ----------------------------------------------------------------------------
// Roda todo dia no GitHub Actions (.github/workflows/sync-drive.yml). Lê os
// arquivos de uma pasta do Google Drive (pessoal — não depende de acesso da
// empresa), identifica sozinho qual tabela cada um é pelo nome do arquivo
// (mesma lógica de demo/upload.html e backend/functions/ingest/index.ts) e
// grava no Supabase.
//
// Se o mapeamento de tabela/coluna mudar em upload.html ou ingest/index.ts,
// espelhe a mudança em lib.js também — são três lugares com a mesma lógica
// por rodarem em ambientes diferentes (navegador, Deno, Node).
//
// A lógica de leitura/normalização das planilhas está em lib.js — dividida
// com build-database-central.js, que monta o DATABASE_GUALAPACK.xlsx a
// partir das mesmas bases (ver esse arquivo pra contexto da arquitetura).
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  TABLE_DEFS, RETENTION_MONTHS, RETENTION_DATE_COL, REPLACE_BY_SOURCE, DEDUPE_KEY,
  CONFLICT_COLUMNS, dedupeRows, detectTables, detectSheet, sheetToRows, coerceRow,
  driveClient, listFolderFiles, downloadFile,
} from "./lib.js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
  const resumo = [];

  try {
    const drive = driveClient();
    const files = await listFolderFiles(drive);

    for (const file of files) {
      const defs = detectTables(file.name);
      if (defs.length === 0) {
        console.log(`[skip] "${file.name}" não bate com nenhuma tabela conhecida.`);
        continue;
      }

      const bytes = await downloadFile(drive, file);

      // Duas passadas: primeiro só a lista de abas (rápido, mesmo em
      // arquivos de 50-100MB), depois relê já filtrando só a aba certa —
      // evita gastar tempo/memória processando abas que não vão ser usadas.
      const sheetNames = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;

      for (const def of defs) {
        const sheetName = detectSheet(def, sheetNames);
        const workbook = XLSX.read(bytes, { type: "array", sheets: [sheetName] });
        const rawRows = sheetToRows(workbook.Sheets[sheetName]);
        if (rawRows.length === 0) {
          console.log(`[skip] "${file.name}" [${sheetName}] -> ${def.table}: aba vazia.`);
          continue;
        }

        let rows = rawRows.map((r) => coerceRow(r, def.numeric, def.date, def.allowed));

        if (rows.every((r) => Object.keys(r).length === 0)) {
          console.log(
            `[skip] "${file.name}" [${sheetName}] -> ${def.table}: nenhuma coluna bateu. ` +
            `Cabeçalhos recebidos: ${Object.keys(rawRows[0]).join(", ")}`
          );
          continue;
        }

        // Linhas de rodapé/resumo (comuns no fim de planilhas com pivot ou
        // total) passam pelo filtro de "linha vazia" porque alguma outra
        // coluna não mapeada tem valor, mas ficam sem a chave da tabela —
        // isso quebrava o insert inteiro (ex: "Conta Refugo" tem uma linha
        // final sem DATE). Descarta só essas linhas, não a carga toda.
        const keyCols = DEDUPE_KEY[def.table];
        if (keyCols) {
          const cols = keyCols.split(",");
          const before = rows.length;
          rows = rows.filter((r) => cols.every((c) => r[c] !== null && r[c] !== undefined));
          if (rows.length < before) {
            console.log(`[aviso] "${file.name}" [${sheetName}] -> ${def.table}: ${before - rows.length} linha(s) sem chave (${keyCols}) descartada(s).`);
          }
        }
        if (rows.length === 0) {
          console.log(`[skip] "${file.name}" [${sheetName}] -> ${def.table}: nenhuma linha com chave válida.`);
          continue;
        }

        const retentionCol = RETENTION_DATE_COL[def.table];
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
        const keptRows = retentionCol
          ? rows.filter((r) => r[retentionCol] && new Date(r[retentionCol]) >= cutoff)
          : rows;
        if (retentionCol && keptRows.length === 0) {
          console.log(`[skip] "${file.name}" [${sheetName}] -> ${def.table}: todas as linhas fora da janela de retenção (${RETENTION_MONTHS} meses).`);
          continue;
        }

        const replaceBySource = REPLACE_BY_SOURCE.has(def.table);
        let toInsert;
        if (replaceBySource) {
          toInsert = keptRows.map((r) => ({ ...r, _source_file: file.name }));
          const { error: delErr } = await supabase.from(def.table).delete().eq("_source_file", file.name);
          if (delErr) throw new Error(`Erro limpando ${def.table} antes de recarregar "${file.name}": ${delErr.message}`);
        } else {
          toInsert = dedupeRows(keptRows, DEDUPE_KEY[def.table]);
        }
        const conflictCols = CONFLICT_COLUMNS[def.table];

        let gravadas = 0;
        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const { error } = replaceBySource
            ? await supabase.from(def.table).insert(chunk)
            : conflictCols
              ? await supabase.from(def.table).upsert(chunk, { onConflict: conflictCols })
              : await supabase.from(def.table).upsert(chunk);
          if (error) throw new Error(`Erro gravando em ${def.table} (${file.name}): ${error.message}`);
          gravadas += chunk.length;
        }

        console.log(`[ok] "${file.name}" [${sheetName}] -> ${def.table}: ${gravadas} linhas`);
        resumo.push(`${file.name} -> ${def.table}: ${gravadas}`);
        totalLinhas += gravadas;
      }
    }

    await logFinish(logId, "ok", resumo.join(" | ") || "nenhum arquivo reconhecido", totalLinhas);
    console.log(`Carga concluída: ${totalLinhas} linhas no total.`);
  } catch (err) {
    console.error("Carga falhou:", err);
    await logFinish(logId, "error", String(err?.message ?? err), totalLinhas);
    process.exit(1);
  }
}

main();
