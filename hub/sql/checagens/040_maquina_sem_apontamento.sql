select 'banco.apontamentos', 'aviso', 'maquina_sem_apontamento',
       printf('máquina %s (recorte %s) não tem nenhum apontamento no ano', rm.maquina, rm.recorte)
from cfg.recorte_maquina rm
cross join cfg.parametros p
where rm.maquina not in (select distinct maquina from clean.machine_card where year(dia) = p.ano);
