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
// espelhe a mudança aqui também — são três lugares com a mesma lógica por
// rodarem em ambientes diferentes (navegador, Deno, Node).
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import * as XLSX from "xlsx";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Tabela -> palavras-chave no nome do arquivo, palavras-chave na aba, e
// colunas numéricas. Espelha TABLES em demo/upload.html.
const TABLE_DEFS = [
  {
    table: "fardos_aparas", fileKeywords: ["sequenciamento"], sheetKeywords: ["completos", "base_aparas_total"],
    numeric: ["numero", "qtd_bruta_kg", "qtd_liquida_kg"], date: { data: "date" },
    allowed: ["codigo", "dp_fp", "refugo", "refile", "data", "numero", "qtd_bruta_kg", "qtd_liquida_kg", "nome", "classificacao", "tipo"],
  },
  {
    table: "aderencia_maquinas_diaria", fileKeywords: ["aderencia_maquinas", "aderenciamaquinas"], sheetKeywords: ["apontamentos_producao"],
    numeric: ["qtd_produzida", "qtd_horas"], date: { dt_producao: "date" },
    allowed: ["num_ordem", "dt_producao", "qtd_produzida", "cod_recurso", "qtd_horas", "classificacao", "descricao", "cod_estrutura", "turno", "cod_desc", "cod_apont"],
  },
  {
    table: "aderencia_programacao", fileKeywords: ["historico_aderencia", "aderencia_programacao"], sheetKeywords: ["programacao_passado"],
    numeric: ["qtd_produzido", "qtd_planejado", "meta_qtd_acerto", "qtd_acerto_real", "min_set_prog", "min_set_real", "qtd_prod_kg", "meta_mts_hora", "qtd_hor_p"],
    date: { dt_saida_maquina: "timestamp" },
    allowed: ["cod_cliente", "cod_estrutura", "recurso_ctr", "tipo_produto", "num_ordem", "dt_saida_maquina", "descricao", "cliente", "atividade", "qtd_produzido", "qtd_planejado", "meta_qtd_acerto", "qtd_acerto_real", "min_set_prog", "min_set_real", "qtd_prod_kg", "meta_mts_hora", "qtd_hor_p", "cilindro"],
  },
  {
    table: "refugo_aparas_historico", fileKeywords: ["refugo_aparas"], sheetKeywords: ["historico_refugo"],
    numeric: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"], date: { data: "date" },
    allowed: ["data", "volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"],
  },
  {
    table: "tendencia_mensal", fileKeywords: ["tendencia", "grafico"], sheetKeywords: ["dados_prod"],
    numeric: ["ano", "volume_prod_corte_km", "lote_medio_km", "volume_prod_kg", "aparas_kg", "aparas_pct"], date: {},
    allowed: ["mes", "ano", "volume_prod_corte_km", "lote_medio_km", "volume_prod_kg", "aparas_kg", "aparas_pct"],
  },
  {
    table: "maquinas", fileKeywords: ["machine_card"], sheetKeywords: ["dim_eqtos"], numeric: [], date: {},
    allowed: ["id", "grupo", "considerar"],
  },
  {
    table: "apontamentos", fileKeywords: ["indicadores", "base_aparas"], sheetKeywords: ["base_maquina", "base_detalhe"],
    numeric: ["qtd_horas", "qtd_produzida", "desperdicio_acerto", "desperdicio_virando", "peso_bruto_bobina", "kg_perda"],
    date: { dt_producao: "date", hora_inicio: "timestamp", hora_fim: "timestamp" },
    allowed: [
      "num_ordem", "cod_recurso", "cod_apont", "cod_desc", "dt_producao", "hora_inicio", "hora_fim", "qtd_horas",
      "qtd_produzida", "turno", "desperdicio_acerto", "desperdicio_virando", "peso_bruto_bobina", "tipo_perda",
      "kg_perda", "nome_operador", "tipo_produto", "cod_estrutura", "des_num_ordem", "cod_est", "processo",
      "classificacao", "nome_cliente",
    ],
  },
];

const CONFLICT_COLUMNS = { refugo_aparas_historico: "data", tendencia_mensal: "mes,ano" };

function normalize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    // cabeçalhos reais vêm em "CamelCase" grudado (ex: "CodApont") — insere
    // "_" entre minúscula/número e a maiúscula seguinte antes de baixar pra
    // minúsculo, senão "CodApont" viraria "codapont" em vez de "cod_apont".
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/\.(xlsx|xls|csv)$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Colunas cujo nome real não bate nem depois de normalizar (prefixo "usr_"
// do sistema de origem, abreviações diferentes etc.) — mapeadas manualmente.
const HEADER_ALIASES = {
  usr_tipodaperda: "tipo_perda",
  usr_kgdaperda: "kg_perda",
  usr_peso_bruto_bobina: "peso_bruto_bobina",
  dp_ou_fp: "dp_fp",             // "DP ou FP" na planilha de fardos
  n: "numero",                   // "Nº" na planilha de fardos
  mini_set_real: "min_set_real", // "Mini_Set_Real" (typo na planilha de origem)
  date: "data",                  // "DATE" no Refugo Aparas
  type_of_machine: "id",         // "Type of Machine" no Machine Card
  machine_group: "grupo",        // "Machine Group" no Machine Card
};

function detectTable(fileName) {
  const norm = normalize(fileName);
  return TABLE_DEFS.find((t) => t.fileKeywords.some((k) => norm.includes(k))) ?? null;
}

function detectSheet(def, sheetNames) {
  return sheetNames.find((n) => def.sheetKeywords.some((k) => normalize(n).includes(k))) ?? sheetNames[0];
}

// O Excel guarda datas como número de série (dias desde 30/12/1899) — o
// SheetJS só converte pra objeto Date sozinho se a célula tiver formatação
// de data nos metadados, o que nem sempre vem preservado.
function excelValueToIso(value, kind) {
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(Math.round((value - 25569) * 86400 * 1000));
  else {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    date = parsed;
  }
  if (Number.isNaN(date.getTime())) return null;
  return kind === "date" ? date.toISOString().slice(0, 10) : date.toISOString();
}

function coerceRow(row, numericCols, dateCols, allowedCols) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalize(key);
    const col = HEADER_ALIASES[normalized] ?? normalized;
    if (!allowedCols.includes(col)) continue; // coluna que não existe na tabela — ignora, não trava a carga
    if (value === "" || value === undefined || value === null) out[col] = null;
    else if (dateCols[col]) out[col] = excelValueToIso(value, dateCols[col]);
    else if (numericCols.includes(col)) out[col] = Number(value);
    else out[col] = value;
  }
  return out;
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

// Arquivos do Google Sheets (criados nativamente no Drive) precisam ser
// exportados; .xlsx/.csv enviados de verdade baixam direto.
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
      const def = detectTable(file.name);
      if (!def) {
        console.log(`[skip] "${file.name}" não bate com nenhuma tabela conhecida.`);
        continue;
      }

      const bytes = await downloadFile(drive, file);

      // Duas passadas: primeiro só a lista de abas (rápido, mesmo em
      // arquivos de 50-100MB), depois relê já filtrando só a aba certa —
      // evita gastar tempo/memória processando abas que não vão ser usadas.
      const sheetNames = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
      const sheetName = detectSheet(def, sheetNames);
      const workbook = XLSX.read(bytes, { type: "array", sheets: [sheetName] });
      const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      if (rawRows.length === 0) {
        console.log(`[skip] "${file.name}" [${sheetName}] está vazia.`);
        continue;
      }

      const rows = rawRows.map((r) => coerceRow(r, def.numeric, def.date, def.allowed));

      if (rows.every((r) => Object.keys(r).length === 0)) {
        console.log(
          `[skip] "${file.name}" [${sheetName}] -> ${def.table}: nenhuma coluna bateu. ` +
          `Cabeçalhos recebidos: ${Object.keys(rawRows[0]).join(", ")}`
        );
        continue;
      }

      const conflictCols = CONFLICT_COLUMNS[def.table];

      let gravadas = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = conflictCols
          ? await supabase.from(def.table).upsert(chunk, { onConflict: conflictCols })
          : await supabase.from(def.table).upsert(chunk);
        if (error) throw new Error(`Erro gravando em ${def.table} (${file.name}): ${error.message}`);
        gravadas += chunk.length;
      }

      console.log(`[ok] "${file.name}" [${sheetName}] -> ${def.table}: ${gravadas} linhas`);
      resumo.push(`${file.name} -> ${def.table}: ${gravadas}`);
      totalLinhas += gravadas;
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
