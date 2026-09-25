-- Velocidade média como o BI Indicadores Produção calcula (VelMédia), com a
-- tabela MachineCard do .pbix. Mesma regra de velocidade_media_machine_card.sql.
with base as (
  select date_trunc('month', dia)::date as periodo, maquina,
         sum(metros) as metros,
         sum(horas) filter (where classe = 'PRODUZINDO') as prod
  from clean.bi_machine_card cross join cfg.parametros p
  where year(dia) = p.ano
  group by 1, 2
), por_recorte as (
  select periodo, rm.recorte, sum(metros) as metros, sum(prod) as prod
  from base join cfg.recorte_maquina rm using (maquina) group by 1, 2
  union all
  select periodo, 'TOTAL', sum(metros), sum(prod) from base group by 1
)
select periodo, recorte, metros as numerador, prod * 60 as denominador,
       metros / nullif(prod * 60, 0) as valor
from por_recorte;
