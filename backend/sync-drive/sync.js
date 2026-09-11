// ============================================================================
// sync.js — carga diária no Supabase, a partir do arquivo central
// (DATABASE_GUALAPACK.xlsx, no Google Drive).
// ----------------------------------------------------------------------------
// Arquitetura (decidida com o usuário em 2026-09-09):
//
//   BASES ORIGINAIS (Drive)
//         |
//   build-database-central.js — lê os originais, escreve as abas DB_
//         |
//   DATABASE_GUALAPACK.xlsx (Drive)
//         |
//   ESTE SCRIPT — lê SÓ esse arquivo, decide INSERT/troca-por-arquivo/upsert
//         |
//   SUPABASE
//
// Antes deste corte, este script lia os 21 arquivos originais direto — ver
// histórico no git (commit anterior a 2026-09-09) se precisar comparar.
// A lógica de coerção de tipos e checagem de chave já rodou dentro de
// build-database-central.js; aqui os valores já vêm prontos (datas em ISO,
// números como número) — só falta decidir como gravar em cada tabela.
//
// Duas tabelas do TABLE_DEFS (aderencia_maquinas_diaria, aderencia_programacao)
// não têm aba própria no arquivo central ainda — e não tinham nenhum arquivo
// de origem real nesta pasta do Drive mesmo antes do corte (confirmado em
// 2026-09-09), então não é uma regressão: já estavam sem dado real.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  RETENTION_MONTHS, RETENTION_DATE_COL, REPLACE_BY_SOURCE, DEDUPE_KEY,
  CONFLICT_COLUMNS, dedupeRows, driveClient, listFolderFiles, downloadFile,
  CENTRAL_FILE_NAME, DB_SHEET_NAME, detectTables,
} from "./lib.js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHEET_TO_TABLE = Object.fromEntries(Object.entries(DB_SHEET_NAME).map(([table, sheet]) => [sheet, table]));

async function logStart() {
  const { data, error } = await supabase.from("sync_log").insert({ status: "running" }).select("id").single();
  if (error) throw new Error(`Não consegui abrir o log de carga: ${error.message}`);
  return data.id;
}
async function logFinish(id, status, detalhe, linhas) {
  await supabase.from("sync_log").update({ status, finished_at: new Date().toISOString(), detalhe, linhas_gravadas: linhas }).eq("id", id);
}

async function findCentralFile(drive) {
  const res = await drive.files.list({
    q: `'${process.env.DRIVE_FOLDER_ID}' in parents and trashed = false and name = '${CENTRAL_FILE_NAME}'`,
    fields: "files(id, name)",
    pageSize: 5,
  });
  const file = res.data.files?.[0];
  if (!file) throw new Error(`"${CENTRAL_FILE_NAME}" não encontrado na pasta do Drive — rode "build-database-central.js" primeiro.`);
  return file;
}

async function main() {
  const logId = await logStart();
  let totalLinhas = 0;
  const resumo = [];

  try {
    const drive = driveClient();
    const centralFile = await findCentralFile(drive);
    const bytes = await downloadFile(drive, centralFile);
    const workbook = XLSX.read(bytes, { type: "array" });

    // Listagem da pasta (só metadados, sem baixar nada) — usada abaixo pra
    // limpar linhas órfãs das tabelas de troca-por-arquivo.
    const allFiles = await listFolderFiles(drive);

    for (const [sheetName, table] of Object.entries(SHEET_TO_TABLE)) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) console.log(`[skip] aba "${sheetName}" não encontrada no arquivo central.`);
      let rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: null }) : [];

      const keyCols = DEDUPE_KEY[table];
      if (keyCols) {
        const cols = keyCols.split(",");
        rows = rows.filter((r) => cols.every((c) => r[c] !== null && r[c] !== undefined));
      }

      const retentionCol = RETENTION_DATE_COL[table];
      if (retentionCol) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
        rows = rows.filter((r) => r[retentionCol] && new Date(r[retentionCol]) >= cutoff);
      }

      const conflictCols = CONFLICT_COLUMNS[table];
      let gravadas = 0;

      if (REPLACE_BY_SOURCE.has(table)) {
        // Cada linha já carrega o nome do arquivo original que a gerou
        // (_source_file, escrito por build-database-central.js) — agrupa
        // por arquivo e troca por arquivo, igual a lógica antiga.
        const porArquivo = new Map();
        for (const r of rows) {
          const key = r._source_file ?? "(sem origem)";
          if (!porArquivo.has(key)) porArquivo.set(key, []);
          porArquivo.get(key).push(r);
        }

        // Órfãos: um arquivo que ALIMENTAVA esta tabela (pelo nome, ainda
        // presente na pasta) mas não trouxe nenhuma linha nesta rodada —
        // aba pulada por tamanho, tudo filtrado pela retenção, etc. Sem
        // isso, o delete abaixo só roda pros arquivos que aparecem NESTA
        // rodada, e o que esse arquivo gravou numa carga anterior fica pra
        // sempre. Foi exatamente o que aconteceu com "Indicadores Diário -
        // 2025.xlsx" na troca do TMR: 46.084 linhas antigas (da aba
        // Máquina_Embalagem, já abandonada) continuaram em "apontamentos"
        // depois que a aba nova (Base Apontamento) passou a ser pulada por
        // ter mais de 250 mil linhas — ver VALIDACAO_DASHBOARD.md.
        const candidatos = allFiles.filter((f) => detectTables(f.name).some((d) => d.table === table));
        for (const orfao of candidatos) {
          if (porArquivo.has(orfao.name)) continue;
          const { error: delErr, count } = await supabase.from(table).delete({ count: "exact" }).eq("_source_file", orfao.name);
          if (delErr) throw new Error(`Erro limpando órfãos de ${table} ("${orfao.name}"): ${delErr.message}`);
          if (count) console.log(`[limpeza] ${table}: removida(s) ${count} linha(s) órfã(s) de "${orfao.name}" (não contribuiu nesta rodada).`);
        }

        for (const [sourceFile, fileRows] of porArquivo) {
          const { error: delErr } = await supabase.from(table).delete().eq("_source_file", sourceFile);
          if (delErr) throw new Error(`Erro limpando ${table} antes de recarregar "${sourceFile}": ${delErr.message}`);
          for (let i = 0; i < fileRows.length; i += 500) {
            const chunk = fileRows.slice(i, i + 500);
            const { error } = await supabase.from(table).insert(chunk);
            if (error) throw new Error(`Erro gravando em ${table} (${sourceFile}): ${error.message}`);
            gravadas += chunk.length;
          }
        }
      } else {
        if (rows.length === 0) {
          console.log(`[skip] "${sheetName}" -> ${table}: aba vazia ou sem linha válida.`);
          continue;
        }
        const toInsert = dedupeRows(rows, keyCols).map((r) => {
          const { _source_file, ...rest } = r; // não é coluna de negócio nessas tabelas
          return rest;
        });
        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const { error } = conflictCols
            ? await supabase.from(table).upsert(chunk, { onConflict: conflictCols })
            : await supabase.from(table).upsert(chunk);
          if (error) throw new Error(`Erro gravando em ${table}: ${error.message}`);
          gravadas += chunk.length;
        }
      }

      console.log(`[ok] "${sheetName}" -> ${table}: ${gravadas} linhas`);
      resumo.push(`${sheetName} -> ${table}: ${gravadas}`);
      totalLinhas += gravadas;
    }

    await logFinish(logId, "ok", resumo.join(" | ") || "nenhuma aba reconhecida", totalLinhas);
    console.log(`Carga concluída: ${totalLinhas} linhas no total.`);
  } catch (err) {
    console.error("Carga falhou:", err);
    await logFinish(logId, "error", String(err?.message ?? err), totalLinhas);
    process.exit(1);
  }
}

main();
