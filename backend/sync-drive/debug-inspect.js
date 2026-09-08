// Script de debug TEMPORÁRIO — lista as abas reais e as 3 primeiras linhas
// dos arquivos/abas que o usuário indicou como corretos, pra confirmar a
// estrutura antes de reescrever TABLE_DEFS. Roda avulso (não faz parte da
// carga normal), sem gravar nada no Supabase. Remover depois de usar.
import { google } from "googleapis";
import * as XLSX from "xlsx";

const TARGETS = [
  { fileMatch: "aderencia semanal", sheets: ["ADERENCIA DIARIA", "ADERENCIA SEMANAL"] },
  { fileMatch: "base aparas - generico", sheets: ["Dinamica"] },
  { fileMatch: "indicadores diario - 2025", sheets: ["Base Apontamentos"] },
  { fileMatch: "indicadores diario - 2026", sheets: ["Base Apontamentos"] },
  { fileMatch: "machine card oficial - generico", sheets: ["Hours Description"] },
  { fileMatch: "refugo producao", sheets: ["Consulta Perda"] },
  { fileMatch: "graficos tendencia", sheets: ["Dados Prod"] },
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
    try {
      const file = files.find((f) => normalize(f.name).includes(normalize(target.fileMatch)));
      if (!file) {
        console.log(`\n=== "${target.fileMatch}" -> ARQUIVO NÃO ENCONTRADO na pasta ===`);
        continue;
      }
      console.log(`\n=== "${file.name}" (match: "${target.fileMatch}") — baixando...`);
      const bytes = await downloadFile(drive, file);
      console.log(`--- baixado (${bytes.length} bytes), listando abas...`);
      const sheetNames = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
      console.log("Abas:", JSON.stringify(sheetNames));

      if (!target.sheets) continue;
      const targetSheets = sheetNames.filter((n) => target.sheets.some((want) => normalize(n).includes(normalize(want)) || normalize(want).includes(normalize(n))));

      for (const sheetName of targetSheets) {
        console.log(`--- lendo aba "${sheetName}"...`);
        const wb = XLSX.read(bytes, { type: "array", sheets: [sheetName] });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
        console.log(`--- aba "${sheetName}" (${raw.length} linhas) — primeiras 8 linhas cruas ---`);
        for (let i = 0; i < Math.min(8, raw.length); i++) {
          console.log(`linha ${i}:`, JSON.stringify(raw[i]).slice(0, 800));
        }
      }
    } catch (err) {
      console.error(`--- erro processando "${target.fileMatch}":`, err?.message ?? err);
    }
  }
}

// XLSX.read() é síncrono/CPU-bound — um watchdog em JS (setTimeout) não
// consegue interromper isso se travar no meio. Quem protege contra isso é
// o "timeout-minutes" no workflow (mata o job inteiro pelo runner, de fora).
main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
