-- Apontamento com código que não existe no cadastro oficial: as horas dele
-- não caem em nenhuma classe, e o TMR fica errado sem ninguém perceber.
select 'indicadores.base_apontamento', 'aviso', 'codigo_sem_classificacao',
       printf('código %s sem classificação oficial: %.1f h em %d apontamentos',
              coalesce(a.cod_apont, '(vazio)'), sum(a.horas), count(*))
from clean.apontamento a
left join clean.classificacao c on c.cod = a.cod_apont
where c.cod is null
group by a.cod_apont;
