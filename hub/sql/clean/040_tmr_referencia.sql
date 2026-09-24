-- Distribuição de horas como o Gráficos Tendência mostra (abas TMR-*), em %.
-- Só linhas de mês ("Janeiro".."Dezembro"); "Semana N" e "YTD" ficam de fora.
-- A planilha guarda fração (0,377); aqui vira porcentagem (37,7).
create or replace table clean.tmr_referencia as
select r.recorte,
       make_date(p.ano, m.num, 1)                    as periodo,
       100 * try_cast(r.setup as double)             as setup_pct,
       100 * try_cast(r.inicializacao as double)     as inicializacao_pct,  -- só Flexo/R18/R20/Roto
       100 * try_cast(r.improdutivo as double)       as improdutivo_pct,
       100 * try_cast(r.inativo as double)           as inativo_pct,
       100 * try_cast(r.produzindo as double)        as produzindo_pct
from raw.graficos__tmr r
join cfg.meses m on m.nome = lower(strip_accents(trim(r.mes)))
cross join cfg.parametros p
where try_cast(r.produzindo as double) is not null;
