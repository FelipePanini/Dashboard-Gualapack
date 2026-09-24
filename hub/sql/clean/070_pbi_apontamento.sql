-- Evento de máquina como o BI "Dados de Produção" carregou (tabela Dados do .pbix).
-- Mesma view do SQL Server que a Base Apontamento do Excel, atualizada em outro momento.
create or replace table clean.pbi_apontamento as
select cast(num_ordem as varchar)                                     as num_ordem,
       upper(trim(cast(cod_recurso as varchar)))                      as maquina,
       case when length(cast(cod_apont as varchar)) = 1
            then '0' || cast(cod_apont as varchar)
            else cast(cod_apont as varchar) end                       as cod_apont,
       cast(dt_producao as date)                                      as dia,
       try_cast(qtd_horas as double)                                  as horas
from raw.pbi__apontamentos
where dt_producao is not null and cod_recurso is not null;
