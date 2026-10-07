-- WIP: pallets em processo disponíveis (view_usr_pallet_wip_disponiveis do
-- Metrics), somados por etapa (atividade da OP), local, cliente e idade.
-- Pallet sem metro nem kg (dividido, zerado) não conta.
-- Idade = dias desde o início da OP até o dado mais novo da foto (a view traz
-- pallets de OPs de 2022 em diante: WIP velho é informação, não erro).
create or replace table clean.wip as
with w as (
  select nullif(trim(cod_ativ), '')       as etapa,
         nullif(trim(local_estoque), '')  as local,
         nullif(trim(op_cliente), '')     as cliente,
         nullif(trim(status_wip), '')     as situacao,
         trim(op)                         as op,
         op_hora_inicio,
         coalesce(qtd_metro_linear, 0)    as metros,
         coalesce(qtd_kg, 0)              as kg
  from raw.banco__wip
  where coalesce(qtd_metro_linear, 0) > 0 or coalesce(qtd_kg, 0) > 0
), ref as (select max(op_hora_inicio) as ref from w)
select coalesce(etapa, 'Sem etapa')    as etapa,
       coalesce(local, 'Sem local')    as local,
       coalesce(cliente, 'Sem cliente') as cliente,
       coalesce(situacao, '')          as situacao,
       case when date_diff('day', op_hora_inicio, ref) <= 7  then '0–7 dias'
            when date_diff('day', op_hora_inicio, ref) <= 30 then '8–30 dias'
            when date_diff('day', op_hora_inicio, ref) <= 90 then '31–90 dias'
            else 'mais de 90 dias' end  as idade,
       count(*)                        as pallets,
       count(distinct op)              as ops,
       sum(metros)                     as metros,
       sum(kg)                         as kg,
       min(op_hora_inicio)             as op_mais_antiga
from w, ref
group by all;
