-- TMR calculado pelo hub: apontamentos do BI + cadastro oficial de classificação.
-- Regra: horas PRODUZINDO ÷ (horas apontadas − FIM TURNO).
-- Reproduz o Gráficos Tendência (ver notas do TMR_PCT em config/indicadores.yaml).
select periodo, recorte,
       sum(horas) filter (where classe = 'PRODUZINDO')        as numerador,
       sum(horas) filter (where classe <> 'FIM TURNO')        as denominador,
       100 * coalesce(numerador, 0) / nullif(denominador, 0)  as valor
from clean.horas_classe
group by periodo, recorte;
