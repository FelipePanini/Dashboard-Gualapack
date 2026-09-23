// Testes das regras de leitura (lib.js). Rodam com `npm test`, sem rede e
// sem credencial — o workflow do build roda isso antes de tocar no Drive.
// Cada caso aqui já foi um bug de verdade; o comentário diz qual.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalize, detectTables, detectSheet, coerceRow, dedupeRows, TABLE_DEFS,
  lerFalhasDoControle, juntarArquivos, COLUNA_FALHAS,
} from "./lib.js";

const def = (table) => TABLE_DEFS.find((d) => d.table === table);

test("normalize separa CamelCase e tira acento", () => {
  assert.equal(normalize("CodApont"), "cod_apont");
  assert.equal(normalize("Indicadores Diário - 2026.xlsx"), "indicadores_diario_2026");
  assert.equal(normalize("Conta Refugo "), "conta_refugo");
});

test("Indicadores Diário alimenta as três tabelas dele", () => {
  const tabelas = detectTables("Indicadores Diário - 2026.xlsx").map((d) => d.table).sort();
  assert.deepEqual(tabelas, ["apontamentos", "classificacao_apontamento", "producao_kg"]);
});

test("Sequenciamento Acumulado não entra em fardos_aparas (contava cada fardo 2x)", () => {
  const tabelas = detectTables("Sequenciamento Acumulado 2026 Rev2.xlsx").map((d) => d.table);
  assert.deepEqual(tabelas, ["scrap_bi_mensal"]);
  const mensal = detectTables("09. SEQUENCIAMENTO DOS FARDOS DE APARAS JGR - Setembro 2026.xlsx").map((d) => d.table);
  assert.deepEqual(mensal, ["fardos_aparas"]);
});

test("aba exata vence aba que só contém a palavra (Base Apontamento x Base Apontamentos (kg))", () => {
  const abas = ["Base Apontamentos (kg)", "Base Apontamento", "Metas"];
  assert.equal(detectSheet(def("apontamentos"), abas), "Base Apontamento");
  assert.equal(detectSheet(def("producao_kg"), abas), "Base Apontamentos (kg)");
});

test("coerceRow aplica alias, número e data serial do Excel", () => {
  const d = def("apontamentos");
  const linha = coerceRow(
    { NumOrdem: "123", usr_kgdaperda: "4.5", DtProducao: 46265, ColunaQueNaoExiste: "x" },
    d.numeric, d.date, d.allowed,
  );
  assert.equal(linha.num_ordem, "123");
  assert.equal(linha.kg_perda, 4.5);
  assert.equal(linha.dt_producao, "2026-08-31");
  assert.equal("coluna_que_nao_existe" in linha, false);
});

test("dedupeRows mantém a linha mais completa, independente da ordem", () => {
  const incompleta = { k: 1, a: null, b: "x" };
  const completa = { k: 1, a: "y", b: "x" };
  assert.deepEqual(dedupeRows([incompleta, completa], "k"), [completa]);
  assert.deepEqual(dedupeRows([completa, incompleta], "k"), [completa]);
});

test("lerFalhasDoControle: arquivo que falhou no build é protegido por aba", () => {
  const controle = [
    { aba: "DB_APONTAMENTOS", [COLUNA_FALHAS]: juntarArquivos(["Indicadores Diário - 2025.xlsx", "Indicadores Diário - 2026.xlsx"]) },
    { aba: "DB_FARDOS_APARAS", [COLUNA_FALHAS]: "" },
    { aba: "DB_ENGENHARIA" },
  ];
  const falhas = lerFalhasDoControle(controle);
  assert.equal(falhas.get("DB_APONTAMENTOS").has("Indicadores Diário - 2026.xlsx"), true);
  assert.equal(falhas.get("DB_APONTAMENTOS").size, 2);
  assert.equal(falhas.has("DB_FARDOS_APARAS"), false);
});

test("lerFalhasDoControle: arquivo central antigo (sem a coluna) não protege nada", () => {
  assert.equal(lerFalhasDoControle([{ aba: "DB_APONTAMENTOS", observacoes: "qualquer" }]).size, 0);
  assert.equal(lerFalhasDoControle(undefined).size, 0);
});
