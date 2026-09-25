-- Apara confirmada pela regra do BI Indicadores Produção (medida
-- "% PerdaConfirm. TOTAL"): scrap total da balança ÷ (peso bruto das REBs +
-- scrap total). Scrap da Refugo Aparas (Conta Refugo), peso bruto da BASE_PROD.
with pb as (
  select date_trunc('month', dia)::date as periodo,
         sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')) as pb_rebs
  from clean.base_prod group by 1
)
select c.mes as periodo, 'TOTAL' as recorte,
       c.scrap_total as numerador, pb.pb_rebs + c.scrap_total as denominador,
       100 * c.scrap_total / nullif(pb.pb_rebs + c.scrap_total, 0) as valor
from clean.apara_confirmada_mes c
join pb on pb.periodo = c.mes
cross join cfg.parametros p
where year(c.mes) = p.ano;
