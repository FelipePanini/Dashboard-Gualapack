-- Tabelas do BI Indicadores Produção (.pbix), só pra conferência: o hub
-- recalcula as medidas do BI com elas e compara com as próprias contas, que
-- saem das planilhas. Mesmas colunas das tabelas clean equivalentes.
create or replace table clean.bi_machine_card as
select cast(dt_producao as date)                               as dia,
       upper(trim(cast(cod_recurso as varchar)))               as maquina,
       nullif(upper(trim(cast(classificacao as varchar))), '') as classe,
       try_cast(qtd_horas as double)                           as horas,
       try_cast(qtd_produzida as double)                       as metros
from raw.pbi_ind__machine_card
where dt_producao is not null;

create or replace table clean.bi_base_prod as
select cast(dt_producao as date)                    as dia,
       upper(trim(cast(maquina_real as varchar)))   as maquina_real,
       coalesce(try_cast(peso_bruto as double), 0)  as peso_bruto,
       coalesce(try_cast(refugo as double), 0)      as refugo
from raw.pbi_ind__aparas_processo
where dt_producao is not null;

create or replace table clean.bi_apara_confirmada_mes as
select date_trunc('month', cast(date as date))::date as mes,
       try_cast(scrap_total as double)               as scrap_total
from raw.pbi_ind__perda_aparas
where date is not null;

create or replace table clean.bi_perda as
select cast(dt_producao as date)                 as dia,
       upper(trim(cast(maquina as varchar)))     as maquina,
       cast(tipo as varchar)                     as tipo,
       try_cast(kg_perda as double)              as kg
from raw.pbi_ind__perda_sistemica
where dt_producao is not null;

create or replace table clean.bi_aderencia as
select cast(dt_ini_plan as date)                      as dia,
       upper(trim(cast(maquina as varchar)))          as maquina,
       coalesce(try_cast(qtd_planejada as double), 0) as planejado,
       coalesce(try_cast(qtd_produzida as double), 0) as produzido
from raw.pbi_ind__aderencia
where dt_ini_plan is not null;
