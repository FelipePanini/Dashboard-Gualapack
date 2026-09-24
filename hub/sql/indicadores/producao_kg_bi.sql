-- Produção total do mês em kg, como o Power BI exporta (aba Percentual Scrap BI).
select periodo, 'TOTAL' as recorte, producao_kg as valor
from clean.scrap_bi;
