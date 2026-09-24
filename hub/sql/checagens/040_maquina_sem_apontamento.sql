-- Máquina listada em config/recortes.yaml que não aparece na base: nome
-- digitado diferente ou máquina parada. Nos dois casos o recorte fica incompleto.
select 'indicadores.base_apontamento', 'aviso', 'maquina_sem_apontamento',
       printf('máquina %s (recorte %s) não tem nenhum apontamento na base', rm.maquina, rm.recorte)
from cfg.recorte_maquina rm
where rm.maquina not in (select distinct maquina from clean.apontamento);
