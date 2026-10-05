-- Perda (refugo) apontada por evento: código 40, com o tipo e o kg.
--
-- Nos meses que o banco cobre (clean.banco_meses), direto da view de
-- apontamentos, código 40 (conferido em 05/10: agosto/2026 com 1.148 linhas e
-- 45.116,10 kg, igual à tabela Apontamentos do banco, à Base Aparas e à tabela
-- Perda Sistêmica do BI, máquina por máquina).
-- Nos outros meses, a aba BASE_DETALHE do Base Aparas: o Genérico cobre desde
-- jun/2025 e é o mais atual; o arquivo de 2025 só entra antes do começo do
-- Genérico (em 30/09 o de 2025 tinha valores velhos da L04 em 23 e 30/12).
create or replace table clean.perda as
with banco as (
  select cast(dt_producao as date) as dia, cod_recurso, num_ordem, '40' as cod_apont, usr_tipodaperda, usr_kgdaperda
  from raw.banco__apontamentos
  where try_cast(cod_apont as integer) = 40
), generico as (
  select cast(dt_producao as date) as dia, cod_recurso, num_ordem, cod_apont, usr_tipodaperda, usr_kgdaperda
  from raw.base_aparas__generico
), antes as (
  select cast(dt_producao as date) as dia, cod_recurso, num_ordem, cod_apont, usr_tipodaperda, usr_kgdaperda
  from raw.base_aparas_2025__detalhe
  where cast(dt_producao as date) < (select coalesce(min(dia), date '9999-12-31') from generico)
), planilhas as (
  select * from generico
  union all by name
  select * from antes
), juntas as (
  select * from banco
  union all by name
  select * from planilhas
  where date_trunc('month', dia)::date not in (select mes from clean.banco_meses)
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
