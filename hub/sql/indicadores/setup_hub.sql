-- % de horas em SETUP, calculado pelo hub. Mesmo denominador do tmr_hub.sql
-- (horas apontadas − FIM TURNO).
select periodo, recorte,
       sum(horas) filter (where classe = 'SETUP')             as numerador,
       sum(horas) filter (where classe <> 'FIM TURNO')        as denominador,
       100 * coalesce(numerador, 0) / nullif(denominador, 0)  as valor
from clean.horas_classe
group by periodo, recorte;
