-- TMR como o BI Indicadores Produção calcula, com a tabela MachineCard do .pbix.
-- Mesma regra de tmr_machine_card.sql.
with base as (
  select date_trunc('month', dia)::date as periodo, maquina,
         sum(horas) filter (where classe = 'PRODUZINDO')                                   as prod,
         sum(horas) filter (where coalesce(classe, '') not in ('FIM TURNO', 'INATIVIDADE')) as tot
  from clean.bi_machine_card cross join cfg.parametros p
  where year(dia) = p.ano
  group by 1, 2
), por_recorte as (
  select periodo, rm.recorte, sum(prod) as prod, sum(tot) as tot
  from base join cfg.recorte_maquina rm using (maquina) group by 1, 2
  union all
  select periodo, 'TOTAL', sum(prod), sum(tot) from base group by 1
)
select periodo, recorte, coalesce(prod, 0) as numerador, tot as denominador,
       100 * coalesce(prod, 0) / nullif(tot, 0) as valor
from por_recorte;
