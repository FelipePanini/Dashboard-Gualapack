-- Uma máquina não pode ter mais de 24 h apontadas num dia (0,5 h de folga
-- pra virada de turno). Acima disso é apontamento duplicado ou sobreposto.
with dia as (
  select maquina, dia, sum(horas) as h
  from clean.apontamento
  group by maquina, dia
  having sum(horas) > 24.5
)
select 'indicadores.base_apontamento', 'aviso', 'mais_de_24h_por_dia',
       printf('%d máquina-dia com mais de 24 h apontadas (maior: %s em %s, %.1f h)',
              count(*), arg_max(maquina, h), strftime(arg_max(dia, h), '%d/%m/%Y'), max(h))
from dia
having count(*) > 0;
