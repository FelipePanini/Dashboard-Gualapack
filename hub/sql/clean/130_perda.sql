-- Perda (refugo) apontada por evento: código 40, com o tipo e o kg. Da aba
-- BASE_DETALHE do Base Aparas (2025 do arquivo de 2025, o resto do Genérico).
-- Igual à tabela Perda Sistêmica do BI Indicadores Produção e aos
-- apontamentos 40 do BI Dados de Produção (conferido em 25/09: 45.116 kg em
-- ago/2026 nos três, máquina por máquina).
create or replace table clean.perda as
with juntas as (
  select cast(dt_producao as date) as dia, cod_recurso, num_ordem, cod_apont, usr_tipodaperda, usr_kgdaperda
  from raw.base_aparas_2025__detalhe where year(cast(dt_producao as date)) = 2025
  union all by name
  select cast(dt_producao as date) as dia, cod_recurso, num_ordem, cod_apont, usr_tipodaperda, usr_kgdaperda
  from raw.base_aparas__generico where year(cast(dt_producao as date)) >= 2026
)
select dia,
       upper(trim(cast(cod_recurso as varchar)))    as maquina,
       cast(num_ordem as varchar)                   as num_ordem,
       trim(cast(usr_tipodaperda as varchar))       as tipo,   -- a planilha traz espaços no fim; o BI não
       try_cast(usr_kgdaperda as double)            as kg
from juntas
where dia is not null and cod_recurso is not null
  and try_cast(usr_kgdaperda as double) is not null
  and cast(cod_apont as varchar) = '40';
