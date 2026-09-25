-- Apara confirmada como o BI Indicadores Produção calcula (% PerdaConfirm.
-- TOTAL), com as tabelas Perda Aparas e Aparas_Processo do .pbix.
with pb as (
  select date_trunc('month', dia)::date as periodo,
         sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')) as pb_rebs
  from clean.bi_base_prod group by 1
), scrap as (
  select mes, sum(scrap_total) as scrap_total from clean.bi_apara_confirmada_mes group by 1
)
select s.mes as periodo, 'TOTAL' as recorte,
       s.scrap_total as numerador, pb.pb_rebs + s.scrap_total as denominador,
       100 * s.scrap_total / nullif(pb.pb_rebs + s.scrap_total, 0) as valor
from scrap s
join pb on pb.periodo = s.mes
cross join cfg.parametros p
where year(s.mes) = p.ano;
