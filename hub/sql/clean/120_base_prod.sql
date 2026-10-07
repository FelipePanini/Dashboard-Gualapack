-- Tabela BASE_PROD (Base Aparas): peso bruto e refugo por OP, máquina e dia.
-- É a tabela Aparas_Processo do BI Indicadores Produção (a apara apontada).
-- Direto do banco desde 05/10/2026, com as regras do Power Query da planilha
-- (lido em 05/10):
--   agrupa por OP + máquina + dia + processo (peso bruto e refugo somados,
--   vazio vira 0; descrição, estrutura e tipo de produto pelo maior valor),
--   sem descrição sai; peso bruto e refugo os dois zerados sai ("SEM PRODUÇÃO");
--   tipo de produto fora REVISAO/TERUEL; processo sem WIP/REVISÃO (vazio sai);
--   descrição sem REVISÃO/REVISAO.
-- maquina_real é a coluna MÁQUINA REAL que a planilha calcula: as embaladoras
-- contam como a rebobinadeira que elas abastecem (EMBAL FLEXI2 e EMBAL. FLEXI
-- -> REB 10, EMBALAGEM3 -> REB 04). O BI soma o peso bruto "das REBs" por ela.
-- Conferido em 05/10: jun/2025 a ago/2026 iguais à planilha (linhas, peso bruto
-- e refugo, ao centavo); set e out/2026 o banco está mais atual; jan a mai/2025
-- a planilha não tinha.
-- grupos: as colunas Classificação..Classificação6 que o Power Query do BI
-- cria (página Aparas_Geral v3), mesmas regras, mesma grafia.
create or replace table clean.base_prod as
with g as (
  select num_ordem, cod_recurso, dt_producao, processo,
         coalesce(sum(usr_peso_bruto_bobina), 0) as peso_bruto,
         coalesce(sum(usr_kgdaperda), 0)         as refugo,
         max(des_num_ordem)                      as descricao,
         max(tipo_produto)                       as tipo_produto
  from raw.banco__apontamentos
  group by num_ordem, cod_recurso, dt_producao, processo
), base as (
  select cast(dt_producao as date) as dia, upper(trim(cod_recurso)) as maquina, num_ordem, descricao, tipo_produto,
         peso_bruto, refugo
  from g
  where descricao is not null
    and not (peso_bruto = 0 and refugo = 0)
    and coalesce(tipo_produto, '') not in ('REVISAO', 'TERUEL')
    and processo is not null and not contains(processo, 'WIP') and not contains(processo, 'REVISÃO')
    and not contains(descricao, 'REVISÃO') and not contains(descricao, 'REVISAO')
)
select dia,
       maquina,
       case maquina when 'EMBAL FLEXI2' then 'REB 10' when 'EMBAL. FLEXI' then 'REB 10'
                    when 'EMBALAGEM3' then 'REB 04' else maquina end   as maquina_real,
       num_ordem,
       descricao,
       tipo_produto,
       peso_bruto,
       refugo,
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
       ], g -> g is not null)                                          as grupos
from base;
