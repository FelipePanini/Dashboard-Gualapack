-- TMR pela regra do BI Indicadores Produção (medidas Horas Produzindo e Horas
-- Totais): horas PRODUZINDO ÷ horas sem FIM TURNO e sem INATIVIDADE. Classe
-- vazia conta no total, como no BI. Tabela Horas do Machine Card (planilha).
-- TOTAL = todas as máquinas da tabela, como o cartão TMR do BI.
with base as (
  select date_trunc('month', dia)::date as periodo, maquina,
         sum(horas) filter (where classe = 'PRODUZINDO')                                   as prod,
         sum(horas) filter (where coalesce(classe, '') not in ('FIM TURNO', 'INATIVIDADE')) as tot
  from clean.machine_card cross join cfg.parametros p
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
