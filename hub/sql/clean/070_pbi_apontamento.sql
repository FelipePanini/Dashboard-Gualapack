-- Evento de máquina como o BI "Dados de Produção" carregou (tabela Dados do .pbix).
-- Mesma view do SQL Server que a Base Apontamento do Excel, porém COMPLETA.
--
-- na_base_apontamento reproduz o filtro da consulta "Base Apontamento" do
-- Indicadores Diário (lido do Power Query da planilha em 24/09):
--   CodRecurso fora de 01CORTESOLDA / REB 10L / REVISORA 01, e
--   not Text.Contains([Processo], "WIP") and not Text.Contains([Processo], "REVISÃO").
-- No Power Query, Text.Contains com Processo vazio dá null e a linha é
-- descartada: por isso parada sem OP (sem processo) não entra na planilha.
create or replace table clean.pbi_apontamento as
select cast(num_ordem as varchar)                                     as num_ordem,
       upper(trim(cast(cod_recurso as varchar)))                      as maquina,
       case when length(cast(cod_apont as varchar)) = 1
            then '0' || cast(cod_apont as varchar)
            else cast(cod_apont as varchar) end                       as cod_apont,
       cast(dt_producao as date)                                      as dia,
       try_cast(qtd_horas as double)                                  as horas,
       try_cast(qtd_produzida as double)                              as qtd_produzida,
       cast(processo as varchar)                                      as processo,
       cast(des_num_ordem as varchar)                                 as descricao,
       coalesce(upper(trim(cast(cod_recurso as varchar))) not in ('01CORTESOLDA', 'REB 10L', 'REVISORA 01')
                and not contains(processo, 'WIP') and not contains(processo, 'REVISÃO'), false)
                                                                      as na_base_apontamento
from raw.pbi__apontamentos
where dt_producao is not null and cod_recurso is not null;
