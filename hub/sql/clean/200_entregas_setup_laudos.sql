-- Entregas no prazo: a classificação do PCP (planilha Aderência Semanal,
-- consulta "Produção (3)") por item faturado, contada por dia de faturamento.
--   1 - ÓTIMO   faturou até a data que o cliente pediu
--   2 - BOM     até a data do PCP
--   3 - REGULAR até 5 dias depois da data do PCP
--   4 - RUIM    de 6 a 10 dias depois
--   5 - PÉSSIMO mais de 10 dias depois
create or replace table clean.entrega_dia as
select cast(faturado as date)                                   as dia,
       coalesce(nullif(trim(status_desempenho), ''), 'Sem classificação') as status,
       coalesce(nullif(trim(cliente), ''), 'Sem cliente')       as cliente,
       count(*)                                                 as itens,
       count(distinct num_nota)                                 as notas
from raw.banco__entregas
where faturado > timestamp '1901-01-01'
group by all;

-- Setup programado x real por OP/atividade, no dia em que a OP saiu da
-- máquina (View_usr_Acompanhamento_Prod do Metrics):
--   programado = tempo de acerto programado da ordem na máquina (minutos)
--   real       = horas dos apontamentos de tipo Setup (S) da OP na máquina × 60
-- Data de saída fora do razoável (o Metrics tem 2087) fica de fora.
create or replace table clean.setup_dia as
select cast(dt_saida_maquina as date)          as dia,
       upper(trim(recurso_ctr))                as maquina,
       count(*)                                as atividades,
       sum(coalesce(min_set_prog, 0))          as min_programado,
       sum(coalesce(mini_set_real, 0))         as min_real,
       count(*) filter (where coalesce(mini_set_real, 0) > coalesce(min_set_prog, 0)) as acima_do_programado
from raw.banco__setup
where dt_saida_maquina > timestamp '2000-01-01' and dt_saida_maquina < current_date + interval 2 day
  and recurso_ctr is not null
group by all;

-- Laudos do CQ por dia e status final (view_usr_LaudoAnalise do Metrics):
-- Aprovado, Aprovado com Reanálise, Reprovado, Reprovado com Reanálise, Novo.
create or replace table clean.laudo_dia as
select cast(dt_laudo as date)                                 as dia,
       coalesce(nullif(trim(status_laudo), ''), 'Sem status') as status,
       count(*)                                               as laudos,
       sum(coalesce(analises, 0))                             as analises
from raw.banco__laudos
where dt_laudo is not null
group by all;
