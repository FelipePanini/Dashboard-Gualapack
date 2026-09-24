-- Produção e refugo total por mês, exportados do Power BI (aba Percentual Scrap BI).
-- A planilha já traz os meses futuros zerados: só entra mês com produção.
create or replace table clean.scrap_bi as
select cast(data as date)                    as periodo,
       try_cast(producao as double)          as producao_kg,
       try_cast(refugo_total as double)      as refugo_kg
from raw.sequenciamento__scrap_bi
where try_cast(producao as double) > 0;
