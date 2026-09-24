-- Horas apontadas por recorte e mês, no BI (tabela Dados). Só o ano do catálogo:
-- a planilha Indicadores Diário é de um ano só.
select date_trunc('month', a.dia)::date as periodo, rm.recorte, sum(a.horas) as valor
from clean.pbi_apontamento a
join cfg.recorte_maquina rm on rm.maquina = a.maquina
cross join cfg.parametros p
where year(a.dia) = p.ano
group by all;
