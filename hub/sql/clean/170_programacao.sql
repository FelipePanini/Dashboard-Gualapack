-- Fila de programação por máquina: as OPs alocadas em cada máquina e ainda
-- não finalizadas, na ordem do início planejado (view_usr_ProgramacaoPlanner,
-- o planejamento do Metrics). Situação da OP como o PCP vê (Liberada,
-- Pendência de matéria-prima, Pendência comercial, Em análise...).
-- As datas de plano vêm como texto ('2027-04-20 12:43:00'); sem data (OP não
-- alocada, '' ou 2000-01-01) fica de fora.
-- Quantidades na unidade da atividade (metros, kg...): o painel mostra o %
-- produzido, que não depende da unidade.
create or replace table clean.programacao as
with p as (
  select upper(trim(maquina))                                       as maquina,
         trim(num_ordem)                                            as num_ordem,
         nullif(trim(nome_cliente), '')                             as cliente,
         nullif(trim(titulo), '')                                   as produto,
         nullif(trim(cod_ativ), '')                                 as atividade,
         nullif(trim(status_op), '')                                as situacao,
         try_strptime(trim(dt_ini_plan), '%Y-%m-%d %H:%M:%S')       as ini_plan,
         try_strptime(trim(dt_fim_plan), '%Y-%m-%d %H:%M:%S')       as fim_plan,
         case when dt_entrega > timestamp '1901-01-01' then cast(dt_entrega as date) end as entrega,
         qtd_planejada, qtd_produzida, saldo, producao_hora
  from raw.banco__programacao
  where maquina is not null
)
select *,
       row_number() over (partition by maquina order by ini_plan, num_ordem) as posicao
from p
where ini_plan > timestamp '2001-01-01';
