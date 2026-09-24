-- Horas apontadas por recorte e mês no BI, com o MESMO recorte da Base
-- Apontamento do Indicadores Diário (sem parada sem OP, sem WIP, sem revisão).
-- É assim que as duas cópias são comparáveis. Só o ano do catálogo.
select date_trunc('month', a.dia)::date as periodo, rm.recorte, sum(a.horas) as valor
from clean.pbi_apontamento a
join cfg.recorte_maquina rm on rm.maquina = a.maquina
cross join cfg.parametros p
where year(a.dia) = p.ano and a.na_base_apontamento
group by all;
