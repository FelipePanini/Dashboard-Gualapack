// ============================================================================
// lib.js — lógica compartilhada de leitura/normalização das planilhas reais.
// Usada por sync.js (carga no Supabase) e build-database-central.js (monta
// o DATABASE_GUALAPACK.xlsx). Extraído de sync.js em 2026-09-09 pra não
// duplicar a mesma lógica de novo — já tínhamos o aviso de espelhar em 3
// lugares (upload.html, ingest/index.ts, sync.js); esse arquivo é a fonte
// única para os dois scripts Node.
// ============================================================================

import { google } from "googleapis";
import * as XLSX from "xlsx";

// Tabela -> palavras-chave no nome do arquivo, palavras-chave na aba, e
// colunas numéricas. Espelha TABLES em demo/upload.html e ALLOWED_COLUMNS
// em backend/functions/ingest/index.ts.
export const TABLE_DEFS = [
  {
    // fileExclude: "Sequenciamento Acumulado 2026.xlsx" repete jan–jun/2026
    // dos arquivos mensais (verificado em 2026-09-09: mesmo intervalo, 1.724
    // x 1.725 linhas, 401.493 x 401.537 kg, 1.495 pares data+nº nas duas
    // fontes). Contava cada fardo duas vezes e inflava a apara apontada de
    // jan a jun. Deduplicar por (data, nº) não resolve: 39% dos fardos não
    // têm número. Os mensais cobrem o mesmo período e ainda vão até agosto,
    // então a fonte oficial são eles. O acumulado continua no inventário.
    table: "fardos_aparas", fileKeywords: ["sequenciamento"], fileExclude: ["acumulado"],
    sheetKeywords: ["completos", "base_aparas_total"],
    numeric: ["numero", "qtd_bruta_kg", "qtd_liquida_kg"], date: { data: "date" },
    allowed: ["codigo", "dp_fp", "refugo", "refile", "data", "numero", "qtd_bruta_kg", "qtd_liquida_kg", "nome", "classificacao", "tipo"],
  },
  {
    table: "aderencia_maquinas_diaria", fileKeywords: ["aderencia_maquinas", "aderenciamaquinas"], sheetKeywords: ["apontamentos_producao"],
    numeric: ["qtd_produzida", "qtd_horas"], date: { dt_producao: "date" },
    allowed: ["num_ordem", "dt_producao", "qtd_produzida", "cod_recurso", "qtd_horas", "classificacao", "descricao", "cod_estrutura", "turno", "cod_desc", "cod_apont"],
  },
  {
    // Fonte trocada em 2026-09-11: "Histórico Aderência Programação.xlsx"
    // (fileKeywords antigos) não existe mais na pasta do Drive — é por
    // isso que aderencia_programacao ficava órfã. A aba real é
    // "ADERÊNCIA DIÁRIA" dentro de "Aderência Semanal.xlsx", já com
    // planejado (qtd_planejada/dt_ini_plan) e realizado (qtd_produzida)
    // cruzados na mesma linha — não precisa juntar duas fontes. Cabeçalhos
    // confirmados na inspeção exaustiva de 2026-09-09 (ver bases-catalog.js
    // DB_ADERENCIA_DIARIA). Chave candidata (num_ordem, maquina,
    // dt_ini_plan) ainda não confirmada contra o dado real — troca por
    // arquivo por enquanto, como as outras tabelas de log de evento.
    table: "aderencia_programacao", fileKeywords: ["aderencia"], sheetKeywords: ["aderencia_diaria"],
    numeric: ["qtd_planejada", "qtd_produzida", "ano"],
    date: { dt_ini_plan: "date", dt_entrega: "date" },
    allowed: ["num_ordem", "maquina", "dt_ini_plan", "qtd_planejada", "produto", "qtd_produzida", "ano", "base", "dt_entrega"],
  },
  {
    // A aba certa é "Conta Refugo " (com espaço no fim) — "Histórico Refugo"
    // existe no arquivo mas é outra coisa; confirmado com o usuário em 2026-09-08.
    table: "refugo_aparas_historico", fileKeywords: ["refugo_aparas"], sheetKeywords: ["conta_refugo"],
    numeric: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"], date: { data: "date" },
    allowed: ["data", "volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"],
  },
  {
    // "Refugo Produção.xlsx" [Consulta Perda] — refugo por evento/máquina/
    // motivo, não tinha nenhuma tabela ainda (sempre caía em "não bate com
    // nenhuma tabela conhecida"). ~68 mil linhas, cresce todo dia.
    table: "refugo_producao", fileKeywords: ["refugo_producao"], sheetKeywords: ["consulta_perda"],
    numeric: ["kg_perda", "dia", "mes", "turno"], date: { dt_producao: "date" },
    allowed: ["op", "maquina", "turno", "dt_producao", "cod_apont", "operador", "processo", "tipo", "kg_perda", "dia", "chave_1", "mes"],
  },
  {
    // "Indicadores Diário - AAAA.xlsx" [Base Apontamentos (kg)] — produção e
    // refugo em kg por ordem/máquina/dia, separado de "apontamentos" (que
    // vem de [Base Máquina_Embalagem] e tem os campos de TMR/Gantt/parada).
    // Mesmo fileKeywords do def "apontamentos" abaixo — um arquivo agora
    // pode alimentar mais de uma tabela (ver detectTables()).
    table: "producao_kg", fileKeywords: ["indicadores"], sheetKeywords: ["base_apontamentos_kg"],
    numeric: ["peso_bruto", "refugo"], date: { dt_producao: "date" },
    allowed: ["num_ordem", "cod_recurso", "dt_producao", "turno", "peso_bruto", "refugo", "descricao", "estrutura", "processo", "tipo_produto", "considerar", "planta", "maquina_real", "chave"],
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
    // Fonte do TMR. Era a aba [Base Máquina_Embalagem], trocada por
    // [Base Apontamento] em 2026-09-10 por decisão do usuário: a de
    // Embalagem cobre só as 5 rebobinadeiras, então 11 das 16 máquinas
    // apareciam com TMR 0%. Validado no Indicadores Diário 2026 (mesmo
    // período, 2026-01-02 → 2026-08-17): 219.623 x 97.282 linhas,
    // 18 x 5 recursos, e CLASSIFICAÇÃO DISP. preenchida em 99,9% das
    // linhas. As duas abas divergem ~20% nas horas totais das 5 máquinas
    // comuns; a Base Apontamento é a oficial e a de Embalagem não é mais
    // lida. Ver docs/mapeamento/VALIDACAO_DASHBOARD.md.
    table: "apontamentos", fileKeywords: ["indicadores", "base_aparas"], sheetKeywords: ["base_apontamento", "base_detalhe"],
    numeric: ["qtd_horas", "qtd_produzida", "desperdicio_acerto", "desperdicio_virando", "peso_bruto_bobina", "kg_perda"],
    date: { dt_producao: "date", hora_inicio: "timestamp", hora_fim: "timestamp" },
    allowed: [
      "num_ordem", "cod_recurso", "cod_apont", "cod_desc", "dt_producao", "hora_inicio", "hora_fim", "qtd_horas",
      "qtd_produzida", "turno", "desperdicio_acerto", "desperdicio_virando", "peso_bruto_bobina", "tipo_perda",
      "kg_perda", "nome_operador", "tipo_produto", "cod_estrutura", "des_num_ordem", "cod_est", "processo",
      "classificacao", "nome_cliente",
      // Só existem na Base Apontamento (a BASE_DETALHE dos Base Aparas
      // não tem, e as linhas dela ficam com null).
      "classificacao_disp", "classificacao_horas",
    ],
  },
];

export const CONFLICT_COLUMNS = { refugo_aparas_historico: "data", tendencia_mensal: "mes,ano" };

// Retenção: as tabelas de apontamento bruto (uma linha por evento de
// máquina) crescem rápido e estouraram os 500 MB do plano free do
// Supabase somando anos de histórico. Ver sync.js pro histórico completo
// dessa decisão.
export const RETENTION_MONTHS = 12;
export const RETENTION_DATE_COL = {
  apontamentos: "dt_producao",
  aderencia_maquinas_diaria: "dt_producao",
  aderencia_programacao: "dt_ini_plan",
  refugo_producao: "dt_producao",
  producao_kg: "dt_producao",
};

// Essas tabelas não têm chave natural nas linhas (são log de eventos, não
// cadastro) — a carga troca por arquivo em vez de tentar upsert. Ver sync.js.
export const REPLACE_BY_SOURCE = new Set([
  "apontamentos", "aderencia_maquinas_diaria", "aderencia_programacao", "fardos_aparas",
  "refugo_producao", "producao_kg",
]);

// Mesma chave, mas usada pra DEDUPLICAR a lista de linhas antes de gravar —
// o Postgres rejeita um upsert que tenta atualizar a MESMA chave duas vezes
// dentro do mesmo lote, e planilhas reais têm linhas repetidas (ex: máquina
// cadastrada duas vezes no Machine Card).
export const DEDUPE_KEY = { ...CONFLICT_COLUMNS, maquinas: "id" };

export function dedupeRows(rows, keyCols) {
  if (!keyCols) return rows;
  const cols = keyCols.split(",");
  const map = new Map();
  for (const row of rows) {
    const key = cols.map((c) => String(row[c] ?? "")).join("|");
    map.set(key, row); // a última ocorrência da chave vence
  }
  return Array.from(map.values());
}

export function normalize(s) {
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
export const HEADER_ALIASES = {
  usr_tipodaperda: "tipo_perda",
  usr_kgdaperda: "kg_perda",
  usr_peso_bruto_bobina: "peso_bruto_bobina",
  dp_ou_fp: "dp_fp",             // "DP ou FP" na planilha de fardos
  n: "numero",                   // "Nº" na planilha de fardos
  mini_set_real: "min_set_real", // "Mini_Set_Real" (typo na planilha de origem)
  date: "data",                  // "DATE" no Refugo Aparas
  type_of_machine: "id",         // "Type of Machine" no Machine Card
  machine_group: "grupo",        // caso um dia o cabeçalho venha limpo
  machine_group_considerar: "grupo", // "Machine Group Considerar ?" — como o cabeçalho
                                      // realmente vem no Machine Card (texto quebrado em
                                      // duas linhas numa célula só); confirmado via log em
                                      // 2026-09-04, ver commit que adicionou esta linha.
  dtentrega: "dt_entrega",       // "DtEntrega" na aba ADERÊNCIA DIÁRIA
};

// Um arquivo pode alimentar mais de uma tabela (ex: "Indicadores Diário"
// tem uma aba pra apontamentos com TMR/Gantt e outra só de produção em kg)
// — por isso retorna TODOS os defs que baterem, não só o primeiro.
export function detectTables(fileName) {
  const norm = normalize(fileName);
  return TABLE_DEFS.filter((t) =>
    t.fileKeywords.some((k) => norm.includes(k)) &&
    !(t.fileExclude ?? []).some((k) => norm.includes(k))
  );
}

// Match exato tem prioridade sobre "contém". O arquivo Indicadores Diário
// tem "Base Apontamento" E "Base Apontamentos (kg)" — a segunda contém a
// palavra-chave da primeira, e sem a prioridade a tabela apontamentos podia
// acabar lendo a aba de kg dependendo da ordem das abas no arquivo.
export function detectSheet(def, sheetNames) {
  const exato = sheetNames.find((n) => def.sheetKeywords.includes(normalize(n)));
  if (exato) return exato;
  return sheetNames.find((n) => def.sheetKeywords.some((k) => normalize(n).includes(k))) ?? sheetNames[0];
}

// O Excel guarda datas como número de série (dias desde 30/12/1899) — o
// SheetJS só converte pra objeto Date sozinho se a célula tiver formatação
// de data nos metadados, o que nem sempre vem preservado.
export function excelValueToIso(value, kind) {
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

// Algumas planilhas (ex: "Graficos Tendência") têm uma linha de título
// mesclada acima do cabeçalho de verdade (célula A preenchida, o resto
// vazio) — sheet_to_json trata essa linha como cabeçalho e gera chaves
// "__EMPTY_N" pro resto, jogando os nomes de coluna reais pra dentro dos
// dados. Lê cru (header:1) e usa a primeira linha com mais de 1 célula
// preenchida como cabeçalho de verdade — pra planilhas sem linha de título
// (a maioria), isso já é a linha 1, então não muda nada.
export function sheetToRows(sheet) {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  let headerIdx = raw.findIndex((row) => row.filter((c) => String(c).trim() !== "").length > 1);
  if (headerIdx === -1) headerIdx = 0;
  const headers = raw[headerIdx].map((h) => String(h ?? "").trim());
  return raw.slice(headerIdx + 1)
    .filter((row) => row.some((c) => String(c).trim() !== ""))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] ?? ""; });
      return obj;
    });
}

export function coerceRow(row, numericCols, dateCols, allowedCols) {
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

export function driveClient(scopes = ["https://www.googleapis.com/auth/drive.readonly"]) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials, scopes });
  return google.drive({ version: "v3", auth });
}

export async function listFolderFiles(drive) {
  const res = await drive.files.list({
    q: `'${process.env.DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id, name, mimeType)",
    pageSize: 100,
  });
  return res.data.files ?? [];
}

// Arquivos do Google Sheets (criados nativamente no Drive) precisam ser
// exportados; .xlsx/.csv enviados de verdade baixam direto.
export const CENTRAL_FILE_NAME = "DATABASE_GUALAPACK.xlsx";

// tabela (mesmo nome usado no Supabase, via TABLE_DEFS) -> nome da aba DB_
// no arquivo central (DATABASE_GUALAPACK.xlsx). Só as abas já validadas
// entram aqui — DB_TMR e DB_ADERENCIA ainda não (ver build-database-central.js).
export const DB_SHEET_NAME = {
  apontamentos: "DB_APONTAMENTOS",
  producao_kg: "DB_PRODUCAO_KG",
  fardos_aparas: "DB_FARDOS_APARAS",
  refugo_aparas_historico: "DB_REFUGO_APARAS",
  refugo_producao: "DB_REFUGO_PRODUCAO",
  tendencia_mensal: "DB_TENDENCIA",
  maquinas: "DB_MAQUINAS",
  aderencia_programacao: "DB_ADERENCIA_DIARIA",
};

export async function downloadFile(drive, file) {
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
