// Script de debug TEMPORÁRIO — lista as abas reais e as 3 primeiras linhas
// dos arquivos/abas que o usuário indicou como corretos, pra confirmar a
// estrutura antes de reescrever TABLE_DEFS. Roda avulso (não faz parte da
// carga normal), sem gravar nada no Supabase. Remover depois de usar.
import { google } from "googleapis";
import * as XLSX from "xlsx";

const TARGETS = [
  { fileMatch: "aderencia semanal", sheets: null }, // lista todas as abas + dump da que bater com o nome dado
  { fileMatch: "base aparas - generico", sheets: ["Dinamica"] },
  { fileMatch: "indicadores diario - 2025", sheets: ["Base Apontamentos (kg)"] },
  { fileMatch: "indicadores diario - 2026", sheets: ["Base Apontamentos (kg)"] },
  { fileMatch: "machine card oficial - generico", sheets: ["Hours Description"] },
  { fileMatch: "refugo producao", sheets: null },
  { fileMatch: "graficos tendencia", sheets: null }, // relista todas as abas pra confirmar se só tem "Dados Prod"
];

function normalize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
}

function driveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

async function listFolderFiles(drive) {
  const res = await drive.files.list({
    q: `'${process.env.DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id, name, mimeType)",
    pageSize: 100,
  });
  return res.data.files ?? [];
}

async function downloadFile(drive, file) {
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { responseType: "arraybuffer" }
    );
    return new Uint8Array(res.data);
  }
  const res = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "arraybuffer" });
  return new Uint8Array(res.data);
}

async function main() {
  const drive = driveClient();
  const files = await listFolderFiles(drive);
  console.log("Arquivos na pasta:", JSON.stringify(files.map((f) => f.name)));

  for (const target of TARGETS) {
    const file = files.find((f) => normalize(f.name).includes(normalize(target.fileMatch)));
    if (!file) {
      console.log(`\n=== "${target.fileMatch}" -> ARQUIVO NÃO ENCONTRADO na pasta ===`);
      continue;
    }
    console.log(`\n=== "${file.name}" (match: "${target.fileMatch}") ===`);
    const bytes = await downloadFile(drive, file);
    const sheetNames = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
    console.log("Abas:", JSON.stringify(sheetNames));

    const targetSheets = target.sheets
      ? sheetNames.filter((n) => target.sheets.some((want) => normalize(n).includes(normalize(want)) || normalize(want).includes(normalize(n))))
      : sheetNames;

    for (const sheetName of targetSheets) {
      const wb = XLSX.read(bytes, { type: "array", sheets: [sheetName] });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
      console.log(`--- aba "${sheetName}" (${raw.length} linhas) — primeiras 4 linhas cruas ---`);
      for (let i = 0; i < Math.min(4, raw.length); i++) {
        console.log(`linha ${i}:`, JSON.stringify(raw[i]));
      }
    }
  }
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
