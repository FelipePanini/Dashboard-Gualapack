-- Tabela "Horas" do Machine Card (2025 + ano corrente): um apontamento por
-- linha, com a classificação pronta (coluna Classificação). É a mesma tabela
-- que o BI Indicadores Produção usa pro TMR e pra velocidade (conferido em
-- 25/09: horas e metros iguais ao BI em todos os meses de 2026).
-- classe vazia fica NULL: o BI conta essas horas no total (não são FIM TURNO
-- nem INATIVIDADE), então as regras usam coalesce(classe, '').
create or replace table clean.machine_card as
with ano_corrente as (
  select cast(dt_producao as date) as dia, cod_recurso, cast(cod_apont as varchar) as cod_apont, cod_desc,
         classificacao, qtd_horas, qtd_produzida, num_ordem
  from raw.machine_card__horas
), ano_2025 as (
  select cast(dt_producao as date) as dia, cod_recurso, cast(cod_apont as varchar) as cod_apont, cod_desc,
         classificacao, qtd_horas, qtd_produzida, num_ordem
  from raw.machine_card_2025__horas
), juntas as (
  select * from ano_2025 where year(dia) = 2025
  union all
  select * from ano_corrente where year(dia) >= 2026
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
