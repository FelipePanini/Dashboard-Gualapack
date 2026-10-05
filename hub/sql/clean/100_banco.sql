-- Banco da fábrica (hub/banco.py): a view de apontamentos, extraída mês a mês.
-- Enquanto a extração não rodou nenhuma vez, as tabelas ficam vazias e as
-- regras abaixo (110, 130) continuam usando as planilhas em todos os meses.
create table if not exists raw.banco__apontamentos (
  id_apontamento varchar, num_ordem varchar, cod_recurso varchar, cod_apont varchar, cod_desc varchar,
  dt_producao timestamp, hora_inicio timestamp, hora_fim timestamp, qtd_horas double, qtd_produzida double,
  turno varchar, tipo_produto varchar, des_num_ordem varchar, processo varchar, classificacao varchar,
  usr_peso_bruto_bobina double, usr_kgdaperda double, usr_tipodaperda varchar);
create table if not exists raw.padroes__classificacao_apontamentos (cod varchar, tipo varchar, classificacao varchar);

-- Meses que o banco cobre: neles, o banco manda; nos outros, as planilhas.
create or replace table clean.banco_meses as
select distinct date_trunc('month', cast(dt_producao as date))::date as mes
from raw.banco__apontamentos
where dt_producao is not null;
