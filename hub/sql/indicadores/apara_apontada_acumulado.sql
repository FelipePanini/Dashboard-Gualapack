-- Apara apontada do mês pelo Sequenciamento Acumulado: (bruta − líquida) ÷ bruta.
-- Mesma definição do painel web (v_fardos_mensal).
select date_trunc('month', dia)::date                    as periodo, 'TOTAL' as recorte,
       sum(bruta_kg) - sum(liquida_kg)                   as numerador,
       sum(bruta_kg)                                     as denominador,
       100 * numerador / nullif(denominador, 0)          as valor
from clean.fardos_fonte
where fonte = 'sequenciamento.fardos'
group by 1;
