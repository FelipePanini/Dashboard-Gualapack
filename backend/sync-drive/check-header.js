import * as XLSX from "xlsx";
import { driveClient, listFolderFiles, downloadFile, normalize } from "./lib.js";

const drive = driveClient();
const files = await listFolderFiles(drive);
const file = files.find((f) => normalize(f.name) === normalize("Machine Card Oficial - Genérico.xlsx"));
if (!file) { console.log("arquivo não encontrado"); process.exit(1); }

const t0 = Date.now();
const bytes = await downloadFile(drive, file);
console.log(`baixado: ${(bytes.length / 1024 / 1024).toFixed(1)} MB em ${Date.now() - t0}ms`);

const sheetNames = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
console.log("todas as abas:", sheetNames.join(" | "));

const alvo = sheetNames.find((n) => normalize(n).includes("producao_metros"));
console.log("\naba encontrada por 'producao_metros':", alvo);

if (alvo) {
  const wb = XLSX.read(bytes, { type: "array", sheets: [alvo], sheetRows: 3 });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[alvo], { header: 1, raw: true });
  console.log("\ncabeçalho real (linha 1):", JSON.stringify(rows[0]));
  console.log("linha de exemplo (linha 2):", JSON.stringify(rows[1]));
}
