-- Apara apontada como o BI Indicadores Produção calcula (% Apontada_Geral
-- REBS), com a tabela Aparas_Processo do .pbix. Mesma regra de apara_bi_regra.sql.
select date_trunc('month', dia)::date as periodo, 'TOTAL' as recorte,
       sum(refugo) as numerador,
       sum(refugo) + sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10'))
         as denominador,
       100 * numerador / nullif(denominador, 0) as valor
from clean.bi_base_prod cross join cfg.parametros p
where year(dia) = p.ano
group by 1;
