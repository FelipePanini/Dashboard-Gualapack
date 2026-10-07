with dia as (
  select a.maquina, a.dia, sum(a.horas) as h
  from clean.machine_card a
  cross join cfg.parametros p
  where year(a.dia) = p.ano
    and a.maquina in (select maquina from cfg.recorte_maquina)   -- as máquinas dos recortes, como a Base Apontamento
  group by a.maquina, a.dia
  having sum(a.horas) > 24.5
)
select 'banco.apontamentos', 'aviso', 'mais_de_24h_por_dia',
       printf('%d máquina-dia com mais de 24 h apontadas no ano (maior: %s em %s, %.1f h)',
              count(*), arg_max(maquina, h), strftime(arg_max(dia, h), '%d/%m/%Y'), max(h))
from dia
having count(*) > 0;
