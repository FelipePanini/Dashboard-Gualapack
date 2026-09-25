-- Aderência ao programado: tabela ADERENCIA_BI da Aderência Semanal (aba
-- ADERÊNCIA DIÁRIA), a mesma do BI Indicadores Produção (página Ad. Plan
-- Diária, medida "% Realizado Prog" = produzido ÷ planejado).
create or replace table clean.aderencia as
select cast(dt_ini_plan as date)                    as dia,
       upper(trim(cast(maquina as varchar)))        as maquina,
       cast(num_ordem as varchar)                   as num_ordem,
       coalesce(try_cast(qtd_planejada as double), 0) as planejado,
       coalesce(try_cast(qtd_produzida as double), 0) as produzido
from raw.aderencia__diaria
where dt_ini_plan is not null and maquina is not null;

-- Apara confirmada (balança) por mês: tabela HISTÓRICOPERDAS3 da Refugo
-- Aparas (aba Conta Refugo), a tabela Perda Aparas do BI. Mesmo filtro do
-- Power Query dele: só mês com VOLUME JGR diferente de zero. A aba tem
-- linhas de total (YTD, ACUMULADO) fora da tabela: saem por não terem data.
create or replace table clean.apara_confirmada_mes as
select cast(try_cast(date as timestamp) as date)    as mes,
       try_cast(volume_jgr as double)               as volume_jgr,
       try_cast(scrap_jgr as double)                as scrap_jgr,
       try_cast(volume_orf as double)               as volume_orf,
       try_cast(scrap_orf as double)                as scrap_orf,
       try_cast(scrap_total as double)              as scrap_total,
       try_cast(scrap_s_refile as double)           as scrap_sem_refile
from raw.refugo__aparas
where try_cast(date as timestamp) is not null
  and coalesce(try_cast(volume_jgr as double), 0) <> 0;
