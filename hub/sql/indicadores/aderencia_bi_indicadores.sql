-- Aderência ao programado como o BI Indicadores Produção calcula (% Realizado
-- Prog), com a tabela Ad. Diário do .pbix. Mesma regra de aderencia_planilha.sql.
with base as (
  select date_trunc('month', dia)::date as periodo, maquina, sum(produzido) as prod, sum(planejado) as plan
  from clean.bi_aderencia cross join cfg.parametros p
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
