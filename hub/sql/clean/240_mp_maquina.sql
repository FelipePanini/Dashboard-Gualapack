-- Pé de máquina: a matéria-prima no pé de cada máquina pelo sistema de bandeiras (o painel
-- de rastreabilidade de MP de cada máquina). A mesma consulta da planilha "Pé de Máquina",
-- lida do Power Query em 15/10/2026. Cada linha é um volume (bobina) num local de máquina,
-- com a bandeira do TransferStatus:
--   1 Aguardando (cinza)         2 Aceito (verde)        3 Aguardando remoção (vermelho)
--   4 Em uso (azul)              5 Aguardando finalização (amarelo)
-- O estoque do almoxarifado (sem bandeira) e o Processado (6) ficam fora já na extração.
-- O local vira a máquina do painel: "MATRIZ - ROTO 01" é a RT01, "MATRIZ - REB10" a REB 10.
create table if not exists raw.banco__mp_maquina (
  cod_item varchar, descricao varchar, local_estoque varchar, transfer_status integer,
  id_volume varchar, quantidade double, data_entrada timestamp);

create or replace table clean.mp_maquina as
with v as (
  select trim(cast(local_estoque as varchar))                           as local,
         upper(trim(replace(cast(local_estoque as varchar), 'MATRIZ - ', ''))) as sem_matriz,
         trim(cast(cod_item as varchar))                                as cod_item,
         trim(cast(descricao as varchar))                               as descricao,
         cast(transfer_status as integer)                               as bandeira,
         -- o banco manda o IdVolume como número: no parquet vira 94424.0; fica o código sem o ".0"
         regexp_replace(trim(cast(id_volume as varchar)), '\.0+$', '')   as id_volume,
         cast(quantidade as double)                                     as quantidade,
         cast(data_entrada as timestamp)                                as data_entrada
  from raw.banco__mp_maquina
  where cast(transfer_status as integer) between 1 and 5
)
select case when sem_matriz = 'ROTO 01' then 'RT01'
            when regexp_matches(sem_matriz, '^REV0?1$') then 'REVISORA 01'
            else regexp_replace(sem_matriz, '^REB\s*([0-9]+)', 'REB \1') end as maquina,
       local, cod_item, descricao, bandeira, id_volume, quantidade, data_entrada
from v;
