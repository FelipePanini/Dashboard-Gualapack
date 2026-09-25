-- Perda apontada (código 40) em kg, da BASE_DETALHE do Base Aparas.
with base as (
  select date_trunc('month', dia)::date as periodo, maquina, sum(kg) as kg
  from clean.perda cross join cfg.parametros p where year(dia) = p.ano group by 1, 2
)
select periodo, rm.recorte, sum(kg) as valor from base join cfg.recorte_maquina rm using (maquina) group by 1, 2
union all
select periodo, 'TOTAL', sum(kg) from base group by 1;
