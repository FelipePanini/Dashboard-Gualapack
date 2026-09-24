-- Produção em metros por OP/máquina/dia (Machine Card, aba Produção (Metros)).
-- É a mesma base que o painel web usa hoje pra velocidade e produtividade.
-- Máquina sem espaço ("REB 05" -> "REB05") pra casar com o BI.
create or replace table clean.producao_metros as
select upper(replace(trim(cast(cod_recurso as varchar)), ' ', ''))  as maquina,
       cast(num_ordem as varchar)                                    as num_ordem,
       cast(dt_producao as date)                                     as dia,
       try_cast(qtd_horas as double)                                 as horas,
       try_cast(qtd_produzida_metros as double)                      as metros,
       try_cast(producao_m as double)                                as m2
from raw.machine_card__producao_metros
where dt_producao is not null and cod_recurso is not null;
