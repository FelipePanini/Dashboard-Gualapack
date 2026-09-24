-- Horas por mês × recorte × classe oficial: a base de todos os indicadores de TMR.
-- Código sem cadastro entra como 'SEM CLASSIFICACAO' (a checagem 010 avisa).
create or replace table clean.horas_classe as
select date_trunc('month', a.dia)::date           as periodo,
       rm.recorte,
       coalesce(c.classe, 'SEM CLASSIFICACAO')    as classe,
       sum(a.horas)                               as horas
from clean.apontamento a
join cfg.recorte_maquina rm   on rm.maquina = a.maquina
left join clean.classificacao c on c.cod = a.cod_apont
group by all;
