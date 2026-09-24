-- Scrap confirmado do mês: refugo total ÷ produção, os dois do Power BI.
select periodo, 'TOTAL' as recorte,
       refugo_kg                                    as numerador,
       producao_kg                                  as denominador,
       100 * refugo_kg / nullif(producao_kg, 0)     as valor
from clean.scrap_bi;
