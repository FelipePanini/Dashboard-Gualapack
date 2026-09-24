-- Base das medidas Velocidade e Vazão do BI (tabela BaseVazao): uma linha por OP,
-- datada pelo último dia de produção da OP ("Data Max").
-- Máquina sem espaço ("REB 05" -> "REB05") pra casar com o Machine Card.
create or replace table clean.vazao_bi as
select upper(replace(trim(cast(maquina as varchar)), ' ', ''))   as maquina,
       cast(op as varchar)                                        as op,
       date_trunc('month', cast(data_max as date))::date          as periodo,
       try_cast(qtd_produzida as double)                          as qtd_produzida,
       try_cast(horas_produzindo as double)                       as horas_produzindo,
       try_cast(horas_totais as double)                           as horas_totais
from raw.pbi__vazao
where data_max is not null and maquina is not null;
