// ============================================================================
// inspect-all.js — INSPEÇÃO EXAUSTIVA (temporária, fase de mapeamento)
// ----------------------------------------------------------------------------
// Percorre TODOS os arquivos da pasta do Drive e, para CADA aba de cada
// arquivo, imprime:
//   - nome da aba
//   - dimensões reais (linhas x colunas)
//   - linha de cabeçalho detectada
//   - 2 linhas de amostra
//
// Não filtra por palavra-chave (diferente do sync/build) — o objetivo é
// descobrir bases que ainda não estão mapeadas em TABLE_DEFS.
//
// Truque de performance: sheetRows limita o parse às primeiras N linhas
// (rápido mesmo em abas de 170 mil linhas), e o SheetJS guarda o range
// original em "!fullref" — então dá pra ter a contagem real de linhas sem
// pagar o custo de parsear a aba inteira.
//
// Só leitura. Não grava nada em lugar nenhum.
// ============================================================================

import * as XLSX from "xlsx";
import { driveClient, listFolderFiles, downloadFile } from "./lib.js";

const required = ["DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const SAMPLE_ROWS = 3;      // linhas de amostra por aba (além do cabeçalho)
const PARSE_ROWS = 12;      // quantas linhas o parse materializa por aba
const MAX_CELL_LEN = 60;    // corta célula longa no log
const MAX_COLS = 30;        // corta aba muito larga no log

function cell(v) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > MAX_CELL_LEN ? s.slice(0, MAX_CELL_LEN) + "…" : s;
}

function rowLine(row) {
  const cols = (row ?? []).slice(0, MAX_COLS).map(cell);
  while (cols.length && cols[cols.length - 1] === "") cols.pop();
  const extra = (row ?? []).length > MAX_COLS ? ` … (+${row.length - MAX_COLS} col)` : "";
  return cols.join(" | ") + extra;
}

// Dimensões a partir do range ("A1:AC170234" -> 170234 linhas x 29 colunas).
function dims(ref) {
  if (!ref) return null;
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  const colNum = (s) => s.split("").reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
  return { linhas: Number(m[4]) - Number(m[2]) + 1, colunas: colNum(m[3]) - colNum(m[1]) + 1 };
}

async function main() {
  const drive = driveClient();
  const files = await listFolderFiles(drive);
  console.log(`### ${files.length} arquivo(s) na pasta do Drive\n`);

  for (const file of files) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(`## ARQUIVO: ${file.name}`);
    console.log(`   id=${file.id} mime=${file.mimeType}`);

    // UMA leitura por arquivo, não uma por aba: cada XLSX.read descompacta o
    // zip inteiro, então ler aba por aba num arquivo de 95 MB com 10 abas
    // significa descompactar 95 MB dez vezes (foi o que travou a 1ª tentativa).
    // sheetRows materializa só as primeiras linhas de CADA aba, então a
    // leitura única sai barata em memória.
    let wb;
    try {
      const t0 = Date.now();
      const bytes = await downloadFile(drive, file);
      console.log(`   tamanho=${(bytes.length / 1024 / 1024).toFixed(1)} MB (download ${Date.now() - t0}ms)`);
      const t1 = Date.now();
      wb = XLSX.read(bytes, { type: "array", sheetRows: PARSE_ROWS });
      console.log(`   parse ${Date.now() - t1}ms`);
    } catch (err) {
      console.log(`   [ERRO] não consegui abrir: ${err.message}`);
      continue;
    }

    const sheetNames = wb.SheetNames;
    console.log(`   ${sheetNames.length} aba(s): ${sheetNames.join(" ; ")}`);

    for (const name of sheetNames) {
      try {
        const sheet = wb.Sheets[name];
        if (!sheet) {
          console.log(`\n   --- ABA "${name}": vazia (sem range)`);
          continue;
        }
        // "!fullref" existe quando sheetRows truncou; senão a aba é pequena.
        const full = dims(sheet["!fullref"] ?? sheet["!ref"]);
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });

        console.log(`\n   --- ABA "${name}" — ${full ? `${full.linhas} linhas x ${full.colunas} colunas` : "dimensão desconhecida"}`);
        if (rows.length === 0) {
          console.log(`       (sem conteúdo)`);
          continue;
        }
        rows.slice(0, 1 + SAMPLE_ROWS).forEach((r, i) => {
          console.log(`       L${i + 1}: ${rowLine(r)}`);
        });
      } catch (err) {
        console.log(`\n   --- ABA "${name}": [ERRO] ${err.message}`);
      }
    }
  }

  console.log(`\n### fim da inspeção`);
}

main().catch((err) => {
  console.error("Inspeção falhou:", err);
  process.exit(1);
});
