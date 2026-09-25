-- Apara apontada pela regra do BI Indicadores Produção (medida
-- "% Apontada_Geral REBS", gráfico Perda GPK): refugo de todas as máquinas ÷
-- (refugo + peso bruto das REBs pela MÁQUINA REAL). Tabela BASE_PROD do Base
-- Aparas (planilha).
select date_trunc('month', dia)::date as periodo, 'TOTAL' as recorte,
       sum(refugo) as numerador,
       sum(refugo) + sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10'))
         as denominador,
       100 * numerador / nullif(denominador, 0) as valor
from clean.base_prod cross join cfg.parametros p
where year(dia) = p.ano
group by 1;
