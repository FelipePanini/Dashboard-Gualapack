-- Planejado x realizado por máquina e dia, como a página "Ad. Plan Mensal" do
-- BI Indicadores (gráfico "Aderência ao Planejado (Km lineares) - Mensal"):
--   planejado = soma da QtdPlanejada da Histórico Aderência Programação (aba
--               PROGRAMAÇÃO, a tabela Programação do BI), pelo dia de início
--               planejado (DtIniPlan);
--   realizado = soma da QtdProduzida dos apontamentos (a tabela Produção
--               Metros do BI: sem processo de WIP nem de revisão), pelo dia de
--               produção.
-- Conferido em 07/10/2026: setembro igual ao BI nas 13 máquinas, nos dois,
-- e o total do mês igual à soma delas.
-- É outra conta que a "Aderência Programado" (ADERÊNCIA DIÁRIA, % por OP).
create table if not exists raw.aderencia__programacao (
  num_ordem varchar, cod_recurso varchar, qtd_planejada double, dt_ini_plan timestamp);

create or replace table clean.plano_dia as
with p as (
  select cast(try_cast(dt_ini_plan as timestamp) as date)   as dia,
         upper(trim(cast(cod_recurso as varchar)))          as maquina,
         sum(try_cast(qtd_planejada as double))             as planejado
  from raw.aderencia__programacao
  where try_cast(dt_ini_plan as timestamp) is not null and nullif(trim(cast(cod_recurso as varchar)), '') is not null
    -- a revisão não entra no realizado (filtros abaixo) nem no gráfico do BI:
    -- em set/2026 a REVISORA 01 tinha 619 km planejados e nada realizado
    and upper(trim(cast(cod_recurso as varchar))) not like 'REVISORA%'
  group by 1, 2
), r as (
  -- os mesmos filtros do Power Query da Produção Metros (Text.Contains diferencia maiúsculas)
  select cast(dt_producao as date)                          as dia,
         upper(trim(cod_recurso))                           as maquina,
         sum(qtd_produzida)                                 as realizado
  from raw.banco__apontamentos
  where dt_producao >= timestamp '2025-01-01' and dt_producao < current_date + interval 2 day
    and processo not like '%WIP%' and processo not like '%REVISÃO%'
    and coalesce(des_num_ordem, '') not like '%REVISAO%'
    and nullif(trim(cod_recurso), '') is not null
  group by 1, 2
)
select coalesce(p.dia, r.dia)              as dia,
       coalesce(p.maquina, r.maquina)      as maquina,
       coalesce(p.planejado, 0)            as planejado,
       coalesce(r.realizado, 0)            as realizado
from p full join r on p.dia = r.dia and p.maquina = r.maquina;
