-- Fardos de aparas (JGR). Duas cópias do mesmo registro:
--   sequenciamento.fardos  histórico do ano (Sequenciamento Acumulado, aba Base Aparas Total)
--   fardos.mensal          arquivo(s) do mês, mais atual(is)
-- Só entra fardo pesado (bruta > 0): o modelo mensal traz linhas em branco
-- pré-numeradas.
create or replace table clean.fardos_fonte as
select 'fardos.mensal'                                   as fonte,
       cast(data as date)                                as dia,
       try_cast(qtd_bruta_kg as double)                  as bruta_kg,
       try_cast(qtd_liquida_kg as double)                as liquida_kg,
       upper(trim(cast(classificacao as varchar)))       as classificacao
from raw.fardos__mensal
where data is not null and try_cast(qtd_bruta_kg as double) > 0
union all
select 'sequenciamento.fardos', cast(data as date), try_cast(qtd_bruta_kg as double),
       try_cast(qtd_liquida_kg as double), upper(trim(cast(classificacao as varchar)))
from raw.sequenciamento__fardos
where data is not null and try_cast(qtd_bruta_kg as double) > 0;

-- Série consolidada, sem contar fardo duas vezes: mês que tem arquivo mensal
-- vem do mensal; os outros meses vêm do Acumulado.
create or replace table clean.fardos as
with meses_mensal as (
  select distinct date_trunc('month', dia) as mes from clean.fardos_fonte where fonte = 'fardos.mensal'
)
select * from clean.fardos_fonte where fonte = 'fardos.mensal'
union all
select * from clean.fardos_fonte
where fonte = 'sequenciamento.fardos'
  and date_trunc('month', dia) not in (select mes from meses_mensal);
