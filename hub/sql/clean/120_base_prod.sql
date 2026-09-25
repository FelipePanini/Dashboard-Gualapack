-- Tabela BASE_PROD do Base Aparas - Genérico: peso bruto e refugo por OP,
-- máquina e dia. É a tabela Aparas_Processo do BI Indicadores Produção (a
-- apara apontada). maquina_real é a coluna MÁQUINA REAL: o BI soma o peso
-- bruto "das REBs" por ela (as embaladoras entram como REB 10).
-- grupos: as colunas Classificação..Classificação6 que o Power Query do BI
-- cria (página Aparas_Geral v3), mesmas regras, mesma grafia.
create or replace table clean.base_prod as
select cast(dt_producao as date)                         as dia,
       upper(trim(cast(cod_recurso as varchar)))         as maquina,
       upper(trim(cast(maquina_real as varchar)))        as maquina_real,
       cast(num_ordem as varchar)                        as num_ordem,
       cast(descricao as varchar)                        as descricao,
       cast(tipo_produto as varchar)                     as tipo_produto,
       coalesce(try_cast(peso_bruto as double), 0)       as peso_bruto,
       coalesce(try_cast(refugo as double), 0)           as refugo,
       list_filter([
         case when tipo_produto in ('ENVOLT0RIO CUT SIZE MICRODOTS', 'ENVOLTORIO CUT SIZE',
                                    'ENVOLTORIO CUT SIZE MD PLUS', 'EXPORTACAO ENV CUT SIZE MICRODOT')
              then 'Sylvamo Bopp & Paper' end,
         case when contains(descricao, 'BULA') or contains(descricao, 'MAIZENA') then 'Bula & Paper' end,
         case when contains(upper(descricao), 'SABONETE') and upper(coalesce(tipo_produto, '')) <> 'HIGIENICOS - MONOCAMADA'
              then 'Soap Wrappen and Multipack' end,
         case when tipo_produto in ('ALIMENTICIOS - LAMINADO', 'EXPORTACAO ENV CUT SIZE', 'FARMACEUTICOS - LAMINADO',
                                    'FLEXIVEL NAO ALIMENTO LAMINADO')
              then 'Simple Laminated' end,
         case when tipo_produto in ('HIGIENICOS - TRILAMINADO', 'FLEXIVEL NAO ALIMENTO TRILAMINAD',
                                    'FARMACEUTICOS - TRILAMINADO', 'ALIMENTICIOS - TRILAMINADO',
                                    'ALIMENTICIOS - QUADRILAMINADO')
              then 'Bi/Tri Laminated' end,
         case when tipo_produto = 'ROTULOS' then 'Rótulos' end
       ], g -> g is not null)                            as grupos
from raw.base_aparas__prod
where dt_producao is not null;
