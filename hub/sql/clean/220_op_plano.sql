-- Programado x produzido por OP e máquina: o que foi produzido a mais que o
-- programado (pedido da gerência em 15/10/2026: o estoque de PA estava
-- descontrolado e não se pode voltar a produzir mais do que o necessário).
--
--   planejado = a QtdPlanejada da ÚLTIMA programação da OP na máquina. A
--               Histórico Aderência Programação repete a OP a cada
--               reprogramação, com a mesma quantidade: somar contava a OP 2, 3
--               vezes (em set/2026, 2549 pares OP × máquina repetidos).
--   produzido = a QtdProduzida da MAIOR passada da OP na máquina (passada =
--               processo). A L04 passa a mesma OP 2 a 3 vezes ("BASE ACETATO",
--               "B ACETATO 2", "B ACETATO 3"), cada vez com o comprimento todo:
--               somadas, davam o dobro do programado em 64 das 66 OPs de
--               set/2026; pela maior passada, a mediana fica em 1,03.
--               Com os filtros da Produção Metros do BI (sem WIP nem revisão).
--   dia       = o último dia em que a máquina produziu a OP (a OP entra uma vez
--               só, no período em que terminou na máquina).
-- Conferido em 15/10/2026, set/2026: 310 OPs × máquina, 317 km acima do
-- programado em 9.543 km programados (3,3%).
create table if not exists raw.aderencia__programacao (
  num_ordem varchar, cod_recurso varchar, qtd_planejada double, dt_ini_plan timestamp);

create or replace table clean.op_plano_dia as
with p as (
  select trim(cast(num_ordem as varchar))                   as num_ordem,
         upper(trim(cast(cod_recurso as varchar)))          as maquina,
         arg_max(try_cast(qtd_planejada as double), try_cast(dt_ini_plan as timestamp)) as planejado
  from raw.aderencia__programacao
  where try_cast(dt_ini_plan as timestamp) is not null
    and nullif(trim(cast(num_ordem as varchar)), '') is not null
    and nullif(trim(cast(cod_recurso as varchar)), '') is not null
    and upper(trim(cast(cod_recurso as varchar))) not like 'REVISORA%'
  group by 1, 2
), passada as (
  select trim(num_ordem)                                    as num_ordem,
         upper(trim(cod_recurso))                           as maquina,
         processo,
         sum(qtd_produzida)                                 as produzido,
         max(cast(dt_producao as date))                     as dia,
         max(des_num_ordem)                                 as produto
  from raw.banco__apontamentos
  where dt_producao >= timestamp '2025-01-01' and dt_producao < current_date + interval 2 day
    and processo not like '%WIP%' and processo not like '%REVISÃO%'
    and coalesce(des_num_ordem, '') not like '%REVISAO%'
    and nullif(trim(num_ordem), '') is not null
    and nullif(trim(cod_recurso), '') is not null
  group by 1, 2, 3
), r as (
  select num_ordem, maquina, max(produzido) as produzido, count(*) as passadas,
         max(dia) as dia, max(produto) as produto
  from passada
  group by 1, 2
)
select r.dia, r.maquina, r.num_ordem, r.produto,
       p.planejado, r.produzido, cast(r.passadas as integer) as passadas
from r join p using (num_ordem, maquina)
where p.planejado > 0 and r.produzido > 0;
