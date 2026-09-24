-- Volume do Corte (JGR + OF) em kg por mês, do bloco da aba "Volume (ton)".
-- Linhas "AVG 24"/"AVG 25" ficam de fora (só nomes de mês casam).
create or replace table clean.volume_corte as
select make_date(p.ano, m.num, 1)       as periodo,
       try_cast(r.kg as double)         as kg
from raw.graficos__volume_corte r
join cfg.meses m on m.nome = lower(strip_accents(trim(r.mes)))
cross join cfg.parametros p
where try_cast(r.kg as double) is not null;
