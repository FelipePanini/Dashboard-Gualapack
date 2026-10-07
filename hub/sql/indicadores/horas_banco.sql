-- Horas apontadas por recorte e mês, direto do banco, com o MESMO recorte da
-- Base Apontamento do Indicadores Diário (sem 01CORTESOLDA, REB 10L e
-- REVISORA 01; processo sem WIP/REVISÃO, e processo vazio — parada sem OP —
-- sai). É o filtro que o BI Dados de Produção também aplica (horas_bi.sql).
select date_trunc('month', cast(a.dt_producao as date))::date as periodo, rm.recorte, sum(a.qtd_horas) as valor
from raw.banco__apontamentos a
join cfg.recorte_maquina rm on rm.maquina = upper(trim(a.cod_recurso))
cross join cfg.parametros p
where year(cast(a.dt_producao as date)) = p.ano
  and upper(trim(a.cod_recurso)) not in ('01CORTESOLDA', 'REB 10L', 'REVISORA 01')
  and a.processo is not null and not contains(a.processo, 'WIP') and not contains(a.processo, 'REVISÃO')
group by all;
