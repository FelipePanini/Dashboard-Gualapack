-- Tabela "Horas" do Machine Card: um apontamento por linha, com a
-- classificação de horas (PRODUZINDO, FIM TURNO...). É a mesma tabela que o
-- BI Indicadores Produção usa pro TMR e pra velocidade.
--
-- Nos meses que o banco cobre (clean.banco_meses), ela é montada direto da
-- view, como o Power Query da planilha faz: todas as linhas do mês, código de
-- apontamento como número, classificação pela tabela-padrão
-- Classificação_Apontamentos (conferido em 05/10: agosto/2026 com as mesmas
-- 29.233 linhas, 11.162,68 h e o mesmo TMR por máquina que a planilha e o BI).
-- Nos outros meses, as planilhas Machine Card (2025 + ano corrente).
-- classe vazia fica NULL: o BI conta essas horas no total (não são FIM TURNO
-- nem INATIVIDADE), então as regras usam coalesce(classe, '').
create or replace table clean.machine_card as
with banco as (
  select cast(a.dt_producao as date) as dia, a.cod_recurso,
         cast(try_cast(a.cod_apont as integer) as varchar) as cod_apont, a.cod_desc,
         c.classificacao, a.qtd_horas, a.qtd_produzida, a.num_ordem
  from raw.banco__apontamentos a
  left join raw.padroes__classificacao_apontamentos c
         on try_cast(c.cod as integer) = try_cast(a.cod_apont as integer)
), ano_corrente as (
  select cast(dt_producao as date) as dia, cod_recurso, cast(cod_apont as varchar) as cod_apont, cod_desc,
         classificacao, qtd_horas, qtd_produzida, num_ordem
  from raw.machine_card__horas
), ano_2025 as (
  select cast(dt_producao as date) as dia, cod_recurso, cast(cod_apont as varchar) as cod_apont, cod_desc,
         classificacao, qtd_horas, qtd_produzida, num_ordem
  from raw.machine_card_2025__horas
), planilhas as (
  select * from ano_2025 where year(dia) = 2025
  union all
  select * from ano_corrente where year(dia) >= 2026
), juntas as (
  select * from banco
  union all
  select * from planilhas
  where date_trunc('month', dia)::date not in (select mes from clean.banco_meses)
)
select dia,
       upper(trim(cast(cod_recurso as varchar)))                               as maquina,
       case when length(cod_apont) = 1 then '0' || cod_apont else cod_apont end as cod_apont,
       cast(cod_desc as varchar)                                               as cod_desc,
       nullif(upper(trim(cast(classificacao as varchar))), '')                 as classe,
       try_cast(qtd_horas as double)                                           as horas,
       try_cast(qtd_produzida as double)                                       as metros,
       cast(num_ordem as varchar)                                              as num_ordem
from juntas
where dia is not null and cod_recurso is not null;
