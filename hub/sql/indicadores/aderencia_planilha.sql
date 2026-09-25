-- Aderência ao programado pela regra do BI Indicadores Produção (medida
-- "% Realizado Prog"): produzido ÷ planejado, pelo mês de início planejado.
-- Tabela ADERENCIA_BI da Aderência Semanal (planilha).
with base as (
  select date_trunc('month', dia)::date as periodo, maquina, sum(produzido) as prod, sum(planejado) as plan
  from clean.aderencia cross join cfg.parametros p
  where year(dia) = p.ano
  group by 1, 2
), por_recorte as (
  select periodo, rm.recorte, sum(prod) as prod, sum(plan) as plan
  from base join cfg.recorte_maquina rm using (maquina) group by 1, 2
  union all
  select periodo, 'TOTAL', sum(prod), sum(plan) from base group by 1
)
select periodo, recorte, prod as numerador, plan as denominador, 100 * prod / nullif(plan, 0) as valor
from por_recorte;
