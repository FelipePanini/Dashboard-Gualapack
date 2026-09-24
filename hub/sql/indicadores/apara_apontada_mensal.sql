-- Apara apontada do mês pelo(s) arquivo(s) mensal(is) de fardos.
select date_trunc('month', dia)::date                    as periodo, 'TOTAL' as recorte,
       sum(bruta_kg) - sum(liquida_kg)                   as numerador,
       sum(bruta_kg)                                     as denominador,
       100 * numerador / nullif(denominador, 0)          as valor
from clean.fardos_fonte
where fonte = 'fardos.mensal'
group by 1;
