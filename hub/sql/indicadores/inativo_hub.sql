-- % de horas INATIVAS, calculado pelo hub. Mesmo denominador do tmr_hub.sql
-- (horas apontadas − FIM TURNO).
-- É onde hub e planilha mais divergem: a planilha parece contar também horas
-- de calendário SEM apontamento como inativas (Roto, maio: 60% x 5%).
-- Pergunta aberta ao dono do indicador; ver notas em config/indicadores.yaml.
select periodo, recorte,
       sum(horas) filter (where classe = 'INATIVIDADE')       as numerador,
       sum(horas) filter (where classe <> 'FIM TURNO')        as denominador,
       100 * coalesce(numerador, 0) / nullif(denominador, 0)  as valor
from clean.horas_classe
group by periodo, recorte;
