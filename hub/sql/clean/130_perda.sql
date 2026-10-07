-- Perda (refugo) apontada por evento: código 40, com o tipo e o kg.
-- Direto do banco: a view de apontamentos, código 40 (conferido em 05/10:
-- agosto/2026 com 1.148 linhas e 45.116,10 kg, igual à tabela Apontamentos do
-- banco, à Base Aparas e à tabela Perda Sistêmica do BI, máquina por máquina).
create or replace table clean.perda as
select cast(dt_producao as date)                  as dia,
       upper(trim(cod_recurso))                   as maquina,
       num_ordem,
       trim(usr_tipodaperda)                      as tipo,   -- o banco traz espaços no fim; o BI não
       usr_kgdaperda                              as kg
from raw.banco__apontamentos
where try_cast(cod_apont as integer) = 40
  and dt_producao is not null and cod_recurso is not null
  and usr_kgdaperda is not null;
