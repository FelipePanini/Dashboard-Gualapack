-- Perda apontada em kg como o BI Indicadores Produção mostra (tabela Perda Sistêmica).
with base as (
  select date_trunc('month', dia)::date as periodo, maquina, sum(kg) as kg
  from clean.bi_perda cross join cfg.parametros p where year(dia) = p.ano group by 1, 2
)
select periodo, rm.recorte, sum(kg) as valor from base join cfg.recorte_maquina rm using (maquina) group by 1, 2
union all
select periodo, 'TOTAL', sum(kg) from base group by 1;
