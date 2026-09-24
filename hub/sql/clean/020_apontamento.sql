-- Evento de máquina (aba Base Apontamento). Uma linha = um apontamento.
-- Obs.: o DuckDB corta texto no lpad, por isso o zero à esquerda é feito com case.
create or replace table clean.apontamento as
select cast(num_ordem as varchar)                                     as num_ordem,
       upper(trim(cast(cod_recurso as varchar)))                      as maquina,
       case when length(cast(cod_apont as varchar)) = 1
            then '0' || cast(cod_apont as varchar)
            else cast(cod_apont as varchar) end                       as cod_apont,
       cast(dt_producao as date)                                      as dia,
       try_cast(qtd_horas as double)                                  as horas,
       _arquivo_id
from raw.indicadores__base_apontamento
where dt_producao is not null and cod_recurso is not null;
