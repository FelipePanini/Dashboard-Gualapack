-- Código de apontamento sem classe na tabela-padrão (config/classificacao_apontamentos.csv):
-- as horas dele entram no total do TMR sem ser FIM TURNO nem INATIVIDADE.
select 'banco.apontamentos', 'aviso', 'codigo_sem_classificacao',
       printf('código %s sem classificação oficial: %.1f h em %d apontamentos (acrescentar em config/classificacao_apontamentos.csv)',
              coalesce(a.cod_apont, '(vazio)'), sum(a.horas), count(*))
from clean.machine_card a
cross join cfg.parametros p
where a.classe is null and year(a.dia) = p.ano
group by a.cod_apont;
