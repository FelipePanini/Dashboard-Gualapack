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
import { coletarBases, COLUNAS_ORIGEM, totalDeLinhas } from "./collect-bases.js";
import { BASES } from "./bases-catalog.js";

const required = ["DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

// Uma base pode vir de vários arquivos (ex: TMR só do Graficos Tendência,
// mas DB_APARAS_DETALHE de 9 Sequenciamentos) — junta tudo na mesma aba.
function mesclarBases(destino, novo) {
  for (const [aba, b] of novo) {
    const atual = destino.get(aba) ?? { linhas: [], colunas: new Set(), origens: [], erros: [] };
    atual.linhas.push(...b.linhas);
    b.colunas.forEach((c) => atual.colunas.add(c));
    atual.origens.push(...b.origens);
    atual.erros.push(...b.erros);
    destino.set(aba, atual);
  }
}

// Um arquivo com layout inesperado não pode derrubar a consolidação inteira.
function coletarBasesSeguro(nome, bytes, importadoEm) {
  try {
    return coletarBases(nome, bytes, importadoEm);
  } catch (err) {
    console.error(`[erro] bases de inventário de "${nome}": ${err.message}`);
    return new Map();
  }
}

// Teto de linhas por aba na extração pro Supabase. 219.623 (Base Apontamento
// de 2026) passa; 379.792 (a de 2025) não terminou de ser lida em 42 min.
// Diferente do TETO_LINHAS_POR_ABA do collect-bases, que é amostragem de
// inventário: aqui não dá pra truncar, porque a janela de retenção quer
// justamente as linhas do FIM da aba — então ou lê inteira, ou pula.
const TETO_LINHAS_TABELA = 250_000;

const PENDENTES = [
  "DB_TMR (Gráficos Tendência.xlsx, abas TMR-*) — aguardando confirmar chave/granularidade mista (máquina x processo).",
  // DB_ADERENCIA promovida pra aderencia_programacao em 2026-09-11 — ver
  // lib.js. Chave (num_ordem, maquina, dt_ini_plan) ainda não confirmada
  // contra o dado real, mas troca-por-arquivo não depende disso.
];

async function collectTableRows(drive, files, importadoEm, porBase) {
  // tabela -> { rows: [...], arquivos: Set, erros: [] }
  const porTabela = new Map();
  const touch = (table) => {
    if (!porTabela.has(table)) porTabela.set(table, { rows: [], arquivos: new Set(), erros: [] });
    return porTabela.get(table);
  };

  for (const file of files) {
    const defs = detectTables(file.name);
    const abastaceSupabase = defs.some((d) => DB_SHEET_NAME[d.table]);

    // Um arquivo pode não alimentar tabela nenhuma do Supabase e mesmo assim
    // ter bases de inventário (é o caso de Aderência Semanal, hoje sem uso).
    if (!abastaceSupabase) {
      try {
        const bytes = await downloadFile(drive, file);
        mesclarBases(porBase, coletarBasesSeguro(file.name, bytes, importadoEm));
      } catch (err) {
        console.error(`[erro] "${file.name}": ${err.message}`);
      }
      continue;
    }

    let bytes;
    try {
      bytes = await downloadFile(drive, file);
    } catch (err) {
      for (const def of defs) if (DB_SHEET_NAME[def.table]) touch(def.table).erros.push(`${file.name}: falha ao baixar (${err.message})`);
      continue;
    }

    // Bases de inventário do mesmo arquivo, reaproveitando o download.
    mesclarBases(porBase, coletarBasesSeguro(file.name, bytes, importadoEm));

    const sheetNames = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;

    // UMA leitura por arquivo com todas as abas de que precisamos. Cada
    // XLSX.read descompacta o zip inteiro: no Indicadores Diário (87 MB,
    // duas tabelas) ler def por def significava descompactar 87 MB duas
    // vezes, e o job estourava o timeout de 30 min.
    const usados = defs.filter((d) => DB_SHEET_NAME[d.table]);
    const abasPorDef = new Map(usados.map((d) => [d.table, detectSheet(d, sheetNames)]));
    const abas = [...new Set(abasPorDef.values())];

    // Sondagem barata antes da leitura de verdade: sheetRows limita o PARSE
    // (a parte cara), e "!fullref" continua trazendo o range real da aba,
    // então dá pra saber o tamanho verdadeiro sem materializar tudo.
    //
    // Por que existe: a aba [Base Apontamento] do "Indicadores Diário -
    // 2025.xlsx" tem 379.792 linhas e não terminou de ser lida em 42 min
    // (o job morreu no timeout, sem gravar nada). A de 2026, com 219.623,
    // leva ~70s. Acima do teto a aba é pulada e registrada no DB_CONTROLE —
    // melhor perder set–dez/2025 de forma explícita do que derrubar o build
    // inteiro e não gravar nem o que já tinha sido lido.
    const sonda = XLSX.read(bytes, { type: "array", sheets: abas, sheetRows: 1 });
    const grandeDemais = new Set();
    for (const aba of abas) {
      const n = totalDeLinhas(sonda.Sheets[aba]);
      if (n !== null && n > TETO_LINHAS_TABELA) grandeDemais.add(aba);
    }

    const lidas = abas.filter((a) => !grandeDemais.has(a));
    let workbook = { Sheets: {} };
    if (lidas.length) {
      try {
        workbook = XLSX.read(bytes, { type: "array", sheets: lidas });
      } catch (err) {
        for (const def of usados) touch(def.table).erros.push(`${file.name}: falha ao ler (${err.message})`);
        console.error(`[erro] "${file.name}": falha ao ler — ${err.message}`);
        continue;
      }
    }

    for (const def of usados) {
      const bucket = touch(def.table);
      try {
        const sheetName = abasPorDef.get(def.table);
        if (grandeDemais.has(sheetName)) {
          const n = totalDeLinhas(sonda.Sheets[sheetName]);
          const msg = `aba "${sheetName}" pulada: ${n} linhas, acima do teto de ${TETO_LINHAS_TABELA}.`;
          bucket.erros.push(`${file.name}: ${msg}`);
          console.warn(`[pulado] "${file.name}": ${msg}`);
          continue;
        }
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          bucket.erros.push(`${file.name}: aba "${sheetName}" não veio na leitura.`);
          continue;
        }
        const rawRows = sheetToRows(sheet);
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

        // push(...array) passa cada linha como ARGUMENTO da chamada, e o V8
        // limita isso a ~125 mil — a Base Apontamento de 2026 tem 219.623
        // linhas e derrubava com "Maximum call stack size exceeded". Só
        // apareceu na troca da fonte do TMR porque a aba antiga tinha 97 mil.
        for (const r of rows) bucket.rows.push({ ...r, _source_file: file.name });
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

function periodo(linhas) {
  const datas = [];
  for (const l of linhas) {
    for (const [k, v] of Object.entries(l)) {
      if (!/^(data|dt_|.*_data)/.test(k) || typeof v !== "string") continue;
      if (/^\d{4}-\d\d-\d\d/.test(v)) datas.push(v.slice(0, 10));
    }
  }
  if (datas.length === 0) return { primeira: "", ultima: "" };
  datas.sort();
  return { primeira: datas[0], ultima: datas[datas.length - 1] };
}

function buildWorkbook(porTabela, porBase, agora) {
  const wb = XLSX.utils.book_new();
  const controleRows = [];

  // 1. Abas que alimentam o Supabase (formato TABLE_DEFS).
  for (const def of TABLE_DEFS) {
    const sheetName = DB_SHEET_NAME[def.table];
    if (!sheetName) continue;
    const bucket = porTabela.get(def.table) ?? { rows: [], arquivos: new Set(), erros: [] };
    // ordem de coluna estável = a mesma ordem de "allowed" no TABLE_DEFS,
    // mais _source_file no fim (controle, não é dado de negócio).
    const header = [...def.allowed, "_source_file"];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bucket.rows, { header }), sheetName);

    const p = periodo(bucket.rows);
    controleRows.push({
      aba: sheetName, destino: `supabase:${def.table}`,
      arquivo_origem: Array.from(bucket.arquivos).join(" | ") || "(nenhum arquivo encontrado)",
      aba_origem: def.sheetKeywords.join(" | "),
      registros: bucket.rows.length, primeira_data: p.primeira, ultima_data: p.ultima,
      data_importacao: agora,
      status: bucket.erros.length ? "erro" : bucket.rows.length ? "ok" : "vazio",
      classificacao: "EM USO", granularidade: "", observacoes: bucket.erros.join(" ; "),
    });
  }

  // 2. Abas de inventário (formato bases-catalog) — não vão pro Supabase
  //    ainda; existem pra podermos comparar e decidir depois.
  for (const base of BASES) {
    const bucket = porBase.get(base.sheet);
    if (!bucket) {
      controleRows.push({
        aba: base.sheet, destino: "inventario", arquivo_origem: "", aba_origem: base.sheetMatch.join(" | "),
        registros: 0, primeira_data: "", ultima_data: "", data_importacao: agora,
        status: "não encontrada", classificacao: base.classificacao,
        granularidade: base.granularidade, observacoes: base.observacao,
      });
      continue;
    }
    const header = [...new Set([...Object.values(base.colunas), "recurso", "recurso_rotulo", "granularidade", ...COLUNAS_ORIGEM])]
      .filter((c) => bucket.colunas.has(c));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bucket.linhas, { header }), base.sheet);

    const p = periodo(bucket.linhas);
    const descartadas = bucket.origens.reduce((s, o) => s + (o.descartadas_retencao || 0), 0);
    const totalOrigem = bucket.origens.reduce((s, o) => s + (o.lidas || 0), 0);
    const amostrada = bucket.origens.some((o) => o.amostrada);
    controleRows.push({
      aba: base.sheet, destino: "inventario",
      arquivo_origem: [...new Set(bucket.origens.map((o) => o.arquivo))].join(" | "),
      aba_origem: [...new Set(bucket.origens.map((o) => o.aba))].join(" | "),
      registros: bucket.linhas.length, registros_na_origem: totalOrigem,
      primeira_data: p.primeira, ultima_data: p.ultima,
      data_importacao: agora,
      status: bucket.erros.length ? "erro" : bucket.linhas.length ? "ok" : "vazio",
      classificacao: base.classificacao, granularidade: base.granularidade,
      observacoes: [
        base.observacao,
        amostrada ? `AMOSTRA: ${bucket.linhas.length} de ${totalOrigem} linhas na origem (limite ${base.amostra}/aba)` : "",
        descartadas ? `${descartadas} linha(s) fora da janela de ${RETENTION_MONTHS} meses` : "",
        ...bucket.erros,
      ].filter(Boolean).join(" ; "),
    });
  }

  for (const texto of PENDENTES) {
    controleRows.push({
      aba: texto.split(" ")[0], destino: "pendente", arquivo_origem: "", aba_origem: "",
      registros: 0, primeira_data: "", ultima_data: "", data_importacao: agora,
      status: "pendente", classificacao: "INCERTA", granularidade: "", observacoes: texto,
    });
  }

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(controleRows, {
    header: ["aba", "destino", "arquivo_origem", "aba_origem", "registros", "registros_na_origem",
      "primeira_data", "ultima_data", "data_importacao", "status", "classificacao",
      "granularidade", "observacoes"],
  }), "DB_CONTROLE");

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

  const agora = new Date().toISOString();
  const porBase = new Map();
  const porTabela = await collectTableRows(drive, files, agora, porBase);
  const wb = buildWorkbook(porTabela, porBase, agora);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  console.log(`Arquivo central montado em memória: ${(buffer.length / 1024 / 1024).toFixed(1)} MB.`);

  await uploadCentralFile(drive, buffer);

  console.log("\nResumo — abas que alimentam o Supabase:");
  for (const [table, bucket] of porTabela) {
    console.log(`  ${DB_SHEET_NAME[table]}: ${bucket.rows.length} linhas de ${bucket.arquivos.size} arquivo(s)${bucket.erros.length ? ` — ${bucket.erros.length} erro(s)` : ""}`);
  }
  console.log("\nResumo — abas de inventário (não vão pro Supabase ainda):");
  for (const base of BASES) {
    const b = porBase.get(base.sheet);
    console.log(`  ${base.sheet.padEnd(28)} ${String(b?.linhas.length ?? 0).padStart(7)} linhas  [${base.classificacao}]${b?.erros.length ? ` — ${b.erros.length} erro(s)` : ""}`);
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
