#!/usr/bin/env node
// ============================================================================
// planilha-uma-aba.js — corta uma planilha grande pra ficar só com UMA aba
// ----------------------------------------------------------------------------
// As planilhas reais da produção (Indicadores Diário, Base Aparas, Machine
// Card, Histórico Aderência...) têm várias abas e pesam de 15 a 100+ MB —
// grande demais pra arrastar direto em demo/upload.html. Este script roda
// no seu computador (fora do site, sem nuvem) e gera uma cópia nova, bem
// menor, contendo só a aba que você escolher — os dados dentro dela não são
// alterados, resumidos nem recalculados, só as outras abas são descartadas.
//
// Uso:
//   node planilha-uma-aba.js "entrada.xlsx" "Nome Da Aba" "saida.xlsx"
//
// Pra descobrir os nomes das abas de um arquivo sem processar tudo:
//   node planilha-uma-aba.js "entrada.xlsx" --listar
// ============================================================================

const XLSX = require("xlsx");
const path = require("node:path");

const [, , inputPath, sheetArg, outputPath] = process.argv;

if (!inputPath) {
  console.error("Uso: node planilha-uma-aba.js entrada.xlsx \"Nome Da Aba\" saida.xlsx");
  console.error("     node planilha-uma-aba.js entrada.xlsx --listar");
  process.exit(1);
}

if (sheetArg === "--listar") {
  // bookSheets:true só lê a lista de abas, sem carregar o conteúdo — rápido
  // mesmo em arquivos gigantes.
  const wb = XLSX.readFile(inputPath, { bookSheets: true });
  console.log(`Abas em "${path.basename(inputPath)}":`);
  wb.SheetNames.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));
  process.exit(0);
}

if (!sheetArg || !outputPath) {
  console.error("Uso: node planilha-uma-aba.js entrada.xlsx \"Nome Da Aba\" saida.xlsx");
  process.exit(1);
}

console.log(`Lendo só a aba "${sheetArg}" de "${inputPath}" (pode levar um tempo em arquivos grandes)...`);

// { sheets: [sheetArg] } faz o SheetJS ler só essa aba do zip interno do
// .xlsx, sem gastar tempo/memória processando as outras.
const wb = XLSX.readFile(inputPath, { sheets: [sheetArg] });

if (!wb.SheetNames.includes(sheetArg)) {
  console.error(`Aba "${sheetArg}" não encontrada. Rode com --listar pra ver os nomes exatos.`);
  process.exit(1);
}

const sheet = wb.Sheets[sheetArg];
const rowCount = XLSX.utils.decode_range(sheet["!ref"] || "A1").e.r;

const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outWb, sheet, sheetArg);
XLSX.writeFile(outWb, outputPath);

console.log(`Pronto: "${outputPath}" gerado com a aba "${sheetArg}" (~${rowCount} linhas).`);
console.log(`Agora é só arrastar esse arquivo em demo/upload.html.`);
