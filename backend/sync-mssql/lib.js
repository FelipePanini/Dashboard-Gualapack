// ============================================================================
// lib.js — conexão com o SQL Server (Metrics) e as consultas traduzidas do
// Power Query pra T-SQL. Ver backend/README-mssql-sync.md pro setup e
// docs/mapeamento/ pro código M original de cada consulta.
// ----------------------------------------------------------------------------
// Servidor: sbrjag-db.br.gpk.gpk-grp.local (== IP 192.168.1.8, confirmado
// com o usuário em 2026-09-11 — mesma máquina, duas formas de endereçar).
// Só alcançável de dentro da rede/VPN da Gualapack — por isso este script
// só roda no runner self-hosted, nunca no GitHub Actions normal.
//
// As consultas abaixo são uma TRADUÇÃO do código M extraído do Power
// Query, não uma cópia exata — SQL e M não são a mesma linguagem, e
// alguns detalhes (ex: Table.Distinct pegando "a primeira ocorrência")
// não têm equivalente 1:1 direto. Cada QUERY_DEFS tem uma nota sobre
// isso. VALIDAR contra os números do Excel antes de confiar de olhos
// fechados — mesma disciplina usada pro resto do projeto.
// ============================================================================

import sql from "mssql";

export const RETENTION_MONTHS = 12;

export function mssqlConfig() {
  const required = ["MSSQL_DOMAIN", "MSSQL_USER", "MSSQL_PASSWORD"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Faltando variável de ambiente: ${key}`);
  }
  return {
    server: "sbrjag-db.br.gpk.gpk-grp.local",
    database: "Metrics",
    authentication: {
      type: "ntlm",
      options: {
        domain: process.env.MSSQL_DOMAIN,
        userName: process.env.MSSQL_USER,
        password: process.env.MSSQL_PASSWORD,
      },
    },
    options: {
      // Servidor on-prem, sem certificado público — mesma situação de
      // praticamente todo SQL Server interno de empresa.
      encrypt: true,
      trustServerCertificate: true,
      connectTimeout: 30000,
      requestTimeout: 120000, // a consulta de produção agrega bastante linha
    },
  };
}

function cutoffDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return d;
}

// ----------------------------------------------------------------------------
// producao_metros ← Machine Card Oficial.xlsx [Produção]
// Fonte M: dbo.View_usr_apontamentos_999999 + dbo.EstrProcessos (largura),
// Sql.Database("sbrjag-db...", "Metrics").
//
// Nota de tradução: o M faz Table.Distinct(..., "CodEstrutura") duas vezes
// seguidas em Larguras (Real), o que na prática só dedupa — assume que
// PFmtPagL é o mesmo pra toda linha de um mesmo CodEstrutura. Aqui uso
// MAX(PFmtPagL) agrupado por CodEstrutura, que dá o mesmo resultado nesse
// caso e é resiliente se um dia houver inconsistência (não trava a carga).
// ----------------------------------------------------------------------------
export async function queryProducaoMetros(pool) {
  const result = await pool.request()
    .input("cutoff", sql.DateTime, cutoffDate())
    .query(`
      with largura as (
        select CodEstrutura, max(PFmtPagL) as largura_real
        from dbo.EstrProcessos
        group by CodEstrutura
      ),
      base as (
        select
          NumOrdem, CodRecurso, DtProducao,
          max(Des_NumOrdem) as descricao,
          max(NomeOperador) as operador,
          max(Turno)        as turno,
          sum(QtdHoras)     as qtd_horas,
          sum(QtdProduzida) as qtd_produzida_m,
          max(CodEst)       as cod_estrutura,
          max(TipoProduto)  as tipo_produto
        from dbo.View_usr_apontamentos_999999
        where DtProducao >= @cutoff
          and Cod_Desc = '20 - Produzindo'
          and (Processo is null or (Processo not like '%WIP%' and Processo not like '%REVISÃO%'))
        group by NumOrdem, CodRecurso, DtProducao
      )
      select
        b.NumOrdem     as num_ordem,
        b.CodRecurso   as cod_recurso,
        b.DtProducao   as dt_producao,
        b.tipo_produto as tipo_produto,
        b.descricao    as descricao,
        b.operador     as operador,
        b.turno        as turno,
        b.qtd_horas    as qtd_horas,
        b.qtd_produzida_m as qtd_produzida_m,
        case when l.largura_real is not null
          then b.qtd_produzida_m * (l.largura_real / 1000.0)
          else null
        end as producao_m2,
        l.largura_real as largura_real,
        b.cod_estrutura as cod_estrutura
      from base b
      left join largura l on l.CodEstrutura = b.cod_estrutura
    `);
  return result.recordset;
}

// ----------------------------------------------------------------------------
// programacao_futura ← Aderência Semanal.xlsx [Programação Futuro]
// Fonte M: Sql.Database("sbrjag-db...", "Metrics",
//   [Query="Select * from View_usr_programacao_teruel"])
//
// Nota de tradução: o M deduplica por uma chave composta
// (NumOrdem+Máquina+Produto) via Table.Distinct — aqui uso SELECT DISTINCT
// nas 5 colunas finais, que é equivalente sempre que não há duas linhas
// com mesma chave e valores de data/quantidade diferentes (caso raro;
// se acontecer, ambas ficam — mais seguro que descartar uma à toa).
//
// Sem filtro de retenção: é dado de programação FUTURA, não histórico —
// olhar pro passado com RETENTION_MONTHS não faz sentido aqui.
// ----------------------------------------------------------------------------
const RECURSOS_EXCLUIDOS = [
  "01-PENDENCIA", "01CORTESOLDA", "02-PENDENCIA", "03-PENDENCIA", "04-PENDENCIA",
  "EMBAL FLEXI2", "EMBAL. FLEXI", "EMBALAGEM2", "EMBALAGEM3", "R15         ",
  "REVISORA 01", "TERCEIRO",
];

export async function queryProgramacaoFutura(pool) {
  const placeholders = RECURSOS_EXCLUIDOS.map((_, i) => `@rec${i}`).join(", ");
  const request = pool.request();
  RECURSOS_EXCLUIDOS.forEach((val, i) => request.input(`rec${i}`, sql.NVarChar, val));

  const result = await request.query(`
    select distinct
      NumOrdem                    as num_ordem,
      LTRIM(RTRIM(CodRecurso))    as maquina,
      DtIniPlan                   as dt_ini_plan,
      QtdPlanejada                as qtd_planejada,
      Produto                     as produto
    from View_usr_programacao_teruel
    where CodRecurso not in (${placeholders})
  `);
  return result.recordset;
}

export const QUERY_DEFS = [
  { table: "producao_metros", run: queryProducaoMetros },
  { table: "programacao_futura", run: queryProgramacaoFutura },
];

export async function connect() {
  return sql.connect(mssqlConfig());
}
