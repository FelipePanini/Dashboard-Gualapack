-- O mesmo código duas vezes no cadastro duplica as horas no join.
select 'indicadores.classificacao', 'erro', 'codigo_duplicado',
       printf('código %s aparece %d vezes no cadastro', cod, count(*))
from clean.classificacao
group by cod
having count(*) > 1;
