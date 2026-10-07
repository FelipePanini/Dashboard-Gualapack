-- Agora no chão de fábrica: o que cada máquina está fazendo.
--
-- A atividade vem do apontamento EM ANDAMENTO da máquina: o Metrics grava o
-- evento assim que ele começa, com a hora de fim vazia ("data zero"
-- 30/12/1899) até ele terminar (conferido em 05/10 às 12:40: L02 e R18
-- produzindo, R20 em acerto de cores desde 09:58, RT01 parada pra limpeza).
-- Evento instantâneo (registro de kg, refugo) não é atividade e fica de fora.
-- A classe (PRODUZINDO, SETUP...) é a da tabela-padrão.
--
-- A OP vem da ordem aberta na máquina no Metrics (CTREntradasMaquina,
-- status 1): a do mesmo número da OP do evento, ou a mais recente. Dela saem
-- o planejado, o produzido bom (contador da máquina, na unidade da OP), a
-- velocidade programada (OrdAtividades.VelocidadeMaquina, em metros por hora:
-- a real ficou entre 0,76 e 1,23 dela em ago–set/2026, menos na HMC01) e o
-- término programado.
-- Velocidade real da OP na máquina: metros ÷ horas produzindo (código 20),
-- como no resto do painel.
create or replace table clean.maquina_agora as
with ap as (
  select upper(trim(cod_recurso))                         as maquina,
         nullif(trim(num_ordem), '')                      as num_ordem,
         case when length(cast(try_cast(cod_apont as integer) as varchar)) = 1  -- lpad do DuckDB corta '111'
              then '0' || cast(try_cast(cod_apont as integer) as varchar)
              else cast(try_cast(cod_apont as integer) as varchar) end   as cod_apont,
         trim(cod_desc)                                   as cod_desc,
         hora_inicio, hora_fim, qtd_horas, qtd_produzida,
         nullif(trim(des_num_ordem), '')                  as produto,
         try_cast(id_apontamento as bigint)               as id,
         dt_inclusao, cast(dt_producao as date)           as dia
  from raw.banco__apontamentos
  -- data digitada errada no futuro (o banco tem inclusão em 2065) não conta como "mais novo"
  where hora_inicio > timestamp '2000-01-01' and hora_inicio < current_date + interval 2 day
    and cod_recurso is not null
), limite as (    -- só máquina com evento nos 7 dias antes do dado mais novo
  select max(hora_inicio) - interval 7 day as desde,
         max(dt_inclusao) filter (where dt_inclusao < current_date + interval 2 day) as dados_ate from ap
), aberto as (
  select ap.*, row_number() over (partition by maquina order by hora_inicio desc, id desc) as r
  from ap, limite
  where (hora_fim is null or hora_fim < timestamp '1901-01-01') and hora_inicio >= limite.desde
), fechado as (   -- sem evento aberto: o último que durou alguma coisa
  select ap.*, row_number() over (partition by maquina order by hora_inicio desc, id desc) as r
  from ap, limite
  where hora_fim > hora_inicio and hora_inicio >= limite.desde
), atual as (
  select coalesce(a.maquina, f.maquina) as maquina,
         coalesce(a.num_ordem, f.num_ordem) as num_ordem_evento,
         coalesce(a.cod_apont, f.cod_apont) as cod_apont,
         coalesce(a.cod_desc, f.cod_desc) as cod_desc,
         coalesce(a.hora_inicio, f.hora_inicio) as desde,
         case when a.maquina is null then f.hora_fim end as terminou_em,   -- nada aberto: até quando foi o último evento
         coalesce(a.produto, f.produto) as produto_evento
  from (select * from aberto where r = 1) a
  full join (select * from fechado where r = 1) f on f.maquina = a.maquina
), op_aberta as (
  select upper(trim(maquina))                                              as maquina,
         nullif(trim(num_ordem), '')                                       as num_ordem,
         nullif(trim(descricao), '')                                       as produto,
         nullif(trim(cliente), '')                                         as cliente,
         nullif(trim(processo), '')                                        as processo,
         dt_hora_inicio                                                    as op_inicio,
         case when dt_hora_inicio_producao > timestamp '1901-01-01' then dt_hora_inicio_producao end as op_inicio_producao,
         bons, qtd_planejado, vmprogramada,
         case when termino_programado > timestamp '1901-01-01' then termino_programado end as termino_programado
  from raw.banco__maquina_agora
), escolhida as (
  select a.maquina, o.*,
         row_number() over (partition by a.maquina
                            order by (o.num_ordem = a.num_ordem_evento) desc nulls last, o.op_inicio desc) as k
  from atual a join op_aberta o on o.maquina = a.maquina
), vel as (
  select maquina, num_ordem,
         sum(qtd_produzida) filter (where cod_apont = '20') as metros,
         sum(qtd_horas) filter (where cod_apont = '20')     as horas_prod
  from ap group by 1, 2
), dia as (       -- o dia de produção mais recente de cada máquina, pra "TMR hoje"
  select m.maquina, m.dia,
         sum(m.horas) filter (where coalesce(m.classe, '') not in ('FIM TURNO', 'INATIVIDADE')) as horas_tot,
         sum(m.horas) filter (where m.classe = 'PRODUZINDO')                                   as horas_prod
  from clean.machine_card m
  where m.dia = (select max(dia) from clean.machine_card where dia <= current_date + interval 1 day)
  group by 1, 2
)
select a.maquina,
       coalesce(c.classe, 'SEM CLASSIFICACAO')                        as classe,
       a.cod_apont,
       a.cod_desc,
       a.desde,
       a.terminou_em,
       coalesce(e.num_ordem, a.num_ordem_evento)                      as num_ordem,
       coalesce(e.produto, a.produto_evento)                          as produto,
       e.cliente,
       e.processo,
       e.op_inicio,
       e.op_inicio_producao,
       e.qtd_planejado                                                as qtd_planejada,
       e.bons                                                         as qtd_boa,
       v.metros / nullif(v.horas_prod, 0) / 60                        as vel_real_m_min,
       e.vmprogramada / 60                                            as vel_programada_m_min,
       e.termino_programado,
       d.dia                                                          as dia,
       d.horas_prod                                                   as horas_prod_dia,
       d.horas_tot                                                    as horas_tot_dia,
       (select dados_ate from limite)                                 as dados_ate
from atual a
left join clean.classificacao c on try_cast(c.cod as integer) = try_cast(a.cod_apont as integer)
left join (select * from escolhida where k = 1) e on e.maquina = a.maquina
left join vel v on v.maquina = a.maquina and v.num_ordem = coalesce(e.num_ordem, a.num_ordem_evento)
left join dia d on d.maquina = a.maquina;
