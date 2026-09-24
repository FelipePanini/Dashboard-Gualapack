-- TMR calculado pelo hub a partir da Base Apontamento + cadastro oficial.
-- Regra v1: horas PRODUZINDO ÷ (horas apontadas − FIM TURNO).
-- Escolhida por evidência em 24/09: com FIM TURNO fora do total, o hub
-- reproduz a planilha na R18 de jan a jul com diferença de 0 a 1,7 p.p.
-- (março exato: 39,0%). Contando FIM TURNO, o erro médio era 5 p.p.
select periodo, recorte,
       sum(horas) filter (where classe = 'PRODUZINDO')        as numerador,
       sum(horas) filter (where classe <> 'FIM TURNO')        as denominador,
       100 * coalesce(numerador, 0) / nullif(denominador, 0)  as valor
from clean.horas_classe
group by periodo, recorte;
