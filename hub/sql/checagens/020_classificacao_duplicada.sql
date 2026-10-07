select null, 'erro', 'codigo_duplicado',
       printf('código %s aparece %d vezes em config/classificacao_apontamentos.csv', cod, count(*))
from clean.classificacao
group by cod
having count(*) > 1;
