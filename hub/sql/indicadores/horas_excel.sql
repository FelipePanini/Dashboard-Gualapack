-- Horas apontadas por recorte e mês, na Base Apontamento do Indicadores Diário.
select date_trunc('month', a.dia)::date as periodo, rm.recorte, sum(a.horas) as valor
from clean.apontamento a
join cfg.recorte_maquina rm on rm.maquina = a.maquina
cross join cfg.parametros p
where year(a.dia) = p.ano
group by all;
