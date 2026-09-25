-- Perda apontada em kg no BI Dados de Produção (tabela Dados, código 40).
with base as (
  select date_trunc('month', cast(dt_producao as date))::date as periodo,
         upper(trim(cast(cod_recurso as varchar))) as maquina,
         sum(try_cast(usr_kgdaperda as double)) as kg
  from raw.pbi__apontamentos cross join cfg.parametros p
  where cast(cod_apont as varchar) = '40' and year(cast(dt_producao as date)) = p.ano
  group by 1, 2
)
select periodo, rm.recorte, sum(kg) as valor from base join cfg.recorte_maquina rm using (maquina) group by 1, 2
union all
select periodo, 'TOTAL', sum(kg) from base group by 1;
