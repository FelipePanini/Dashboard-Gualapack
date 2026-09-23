// ============================================================================
// sync.js — ETAPA 2 da carga diária: DATABASE_GUALAPACK.xlsx -> Supabase.
// ----------------------------------------------------------------------------
//   build-database-central.js (ETAPA 1) — planilhas originais -> arquivo central
//         |
//   DATABASE_GUALAPACK.xlsx (Drive)
//         |
//   ESTE SCRIPT — lê SÓ esse arquivo, decide troca-por-arquivo/upsert
//         |
//   SUPABASE
//
// A coerção de tipos e a checagem de chave já rodaram no build; aqui os
// valores já chegam prontos (datas em ISO, números como número) — só falta
// decidir como gravar em cada tabela.
//
// aderencia_maquinas_diaria não tem aba no arquivo central: o arquivo de
// origem dela não existe mais na pasta do Drive.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  RETENTION_MONTHS, RETENTION_DATE_COL, REPLACE_BY_SOURCE, DEDUPE_KEY,
  CONFLICT_COLUMNS, dedupeRows, driveClient, listFolderFiles, downloadFile,
  CENTRAL_FILE_NAME, DB_SHEET_NAME, detectTables, lerFalhasDoControle, juntarArquivos,
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

// O PostgREST/service_role tem statement_timeout de 8s (config de
// "authenticator", herdada mesmo depois do SET ROLE) — um DELETE direto por
// _source_file em tabela grande (ex.: apontamentos, ~220 mil linhas por
// arquivo) estoura isso. Apaga em lotes por id, cada lote rápido o
// suficiente pra nunca chegar perto do limite.
async function deleteBySourceFile(table, sourceFile, batchSize = 500) {
  let total = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select("id").eq("_source_file", sourceFile).limit(batchSize);
    if (error) throw new Error(`Erro lendo ids pra limpar ${table} ("${sourceFile}"): ${error.message}`);
    if (!data.length) break;
    // batchSize pequeno de propósito: um .in("id", ids) com milhares de ids
    // vira uma URL gigante (DELETE do PostgREST manda o filtro na query
    // string) — foi exatamente isso que causou duplicação silenciosa em
    // "apontamentos" em 2026-09-14: o delete "estourava" o limite de
    // tamanho de URL, mas em vez de dar erro claro ele simplesmente não
    // apagava nada, e a carga seguinte inseria tudo de novo por cima.
    const { error: delErr } = await supabase.from(table).delete().in("id", data.map((r) => r.id));
    if (delErr) throw new Error(`Erro limpando ${table} antes de recarregar "${sourceFile}": ${delErr.message}`);
    total += data.length;
    if (data.length < batchSize) break;
  }

  // Verificação final: se sobrou QUALQUER linha desse arquivo depois do
  // loop, é sinal de que o delete não funcionou de verdade (do jeito que
  // aconteceu antes) — falha alto e claro em vez de deixar duplicar de novo.
  const { count, error: checkErr } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("_source_file", sourceFile);
  if (checkErr) throw new Error(`Erro verificando limpeza de ${table} ("${sourceFile}"): ${checkErr.message}`);
  if (count > 0) throw new Error(`Limpeza de ${table} ("${sourceFile}") não removeu tudo: ainda sobraram ${count} linha(s) depois do loop de delete.`);

  return total;
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
    // Só as abas que o sync usa. O arquivo central também carrega ~27 abas
    // de inventário (uma delas com 170 mil linhas) que nunca vão pro
    // Supabase — ler o arquivo inteiro gastava memória e tempo à toa.
    const workbook = XLSX.read(bytes, { type: "array", sheets: [...Object.keys(SHEET_TO_TABLE), "DB_CONTROLE"] });

    // Arquivos que falharam no build, por aba. Esses NÃO têm o dado antigo
    // apagado abaixo — ver lerFalhasDoControle em lib.js.
    const controle = workbook.Sheets.DB_CONTROLE ? XLSX.utils.sheet_to_json(workbook.Sheets.DB_CONTROLE, { defval: null }) : [];
    const falhasPorAba = lerFalhasDoControle(controle);

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
        // presente na pasta) mas não trouxe nenhuma linha nesta rodada. Sem
        // essa limpeza, o delete abaixo só roda pros arquivos que aparecem
        // NESTA rodada, e o que o arquivo gravou antes fica pra sempre (foi o
        // caso das 46.084 linhas da aba Máquina_Embalagem, já abandonada —
        // ver VALIDACAO_DASHBOARD.md).
        //
        // Exceção: arquivo que FALHOU no build (aba pulada por tamanho, erro
        // de leitura...). Zero linhas ali não quer dizer "não tem mais dado",
        // quer dizer "não deu pra ler hoje" — apagar zeraria o painel, como
        // aconteceu com as horas de 2026 em 18/09. O dado anterior fica.
        const falharam = falhasPorAba.get(sheetName) ?? new Set();
        const mantidos = [];
        const candidatos = allFiles.filter((f) => detectTables(f.name).some((d) => d.table === table));
        for (const orfao of candidatos) {
          if (porArquivo.has(orfao.name)) continue;
          if (falharam.has(orfao.name)) {
            mantidos.push(orfao.name);
            console.warn(`[mantido] ${table}: "${orfao.name}" falhou no build — linhas da carga anterior mantidas.`);
            continue;
          }
          const count = await deleteBySourceFile(table, orfao.name);
          if (count) console.log(`[limpeza] ${table}: removida(s) ${count} linha(s) órfã(s) de "${orfao.name}" (não contribuiu nesta rodada).`);
        }
        if (mantidos.length) resumo.push(`${table}: dado anterior mantido de ${juntarArquivos(mantidos)} (falha no build)`);

        for (const [sourceFile, fileRows] of porArquivo) {
          await deleteBySourceFile(table, sourceFile);
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
