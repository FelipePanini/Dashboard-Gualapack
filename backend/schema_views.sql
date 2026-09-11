-- ============================================================================
-- Painel de Produção Gualapack — views agregadas pro dashboard
-- Alvo: Supabase (Postgres 15+). Rode depois de schema_data.sql, uma vez.
-- ----------------------------------------------------------------------------
-- As tabelas brutas (apontamentos, aderencia_maquinas_diaria,
-- aderencia_programacao...) têm centenas de milhares de linhas — o
-- navegador NUNCA deve fazer select nelas direto. Estas views fazem a soma/
-- agrupamento dentro do banco; demo/index.html só lê o resultado, que é
-- sempre pequeno (algumas dezenas de linhas, no máximo).
--
-- "security_invoker = true" faz a view respeitar o RLS das tabelas de
-- origem com base em quem está consultando (não em quem criou a view) —
-- sem isso, uma view roda com o privilégio de quem a criou, ignorando RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Resumo por máquina — TMR, horas, perda, aderência (planejado/realizado)
--    Só entram máquinas de produção de verdade (grupo físico) — o Machine
--    Card mistura máquinas reais com categorias administrativas (GERAL,
--    IMPRESSORAS, MANUTENÇÃO...) que não são recursos físicos.
-- ----------------------------------------------------------------------------
create or replace view public.v_maquinas_resumo
with (security_invoker = true) as
select
  m.id,
  m.grupo,
  coalesce(ap.horas_totais, 0)      as horas_totais,
  coalesce(ap.horas_produzindo, 0)  as horas_produzindo,
  coalesce(ap.kg_perda_total, 0)    as kg_perda_total,
  coalesce(ap.peso_bruto_total, 0)  as peso_bruto_total,
  -- Nomes neutros de propósito: a fonte antiga (arquivo morto, "Histórico
  -- Aderência Programação.xlsx") tinha esses campos rotulados como "km" e
  -- chegou a mostrar 12,3 bilhões de "km" — número absurdo da fonte errada.
  -- A fonte nova (ADERÊNCIA DIÁRIA) não confirma a unidade de qtd_planejada/
  -- qtd_produzida ainda — não relabelar como km/m sem confirmar.
  coalesce(ad.qtd_planejada, 0)      as qtd_planejada,
  coalesce(ad.qtd_produzida, 0)      as qtd_produzida
from public.maquinas m
left join (
  select
    cod_recurso,
    sum(qtd_horas)                                    as horas_totais,
    sum(qtd_horas) filter (where cod_apont = '20')    as horas_produzindo,
    sum(kg_perda)                                     as kg_perda_total,
    sum(peso_bruto_bobina)                            as peso_bruto_total
  from public.apontamentos
  where cod_recurso is not null
  group by cod_recurso
) ap on ap.cod_recurso = m.id
left join (
  select
    maquina,
    sum(qtd_planejada) as qtd_planejada,
    sum(qtd_produzida)  as qtd_produzida
  from public.aderencia_programacao
  where maquina is not null
  group by maquina
) ad on ad.maquina = m.id
where m.grupo in ('COATING','LAMINADORAS','FUNGICIDA','FLEXOGRAFIA','CORTADEIRAS','ROTOGRAVURA','HOT MELT');

-- ----------------------------------------------------------------------------
-- 2. Perda por motivo (código real usr_tipodaperda -> kg)
-- ----------------------------------------------------------------------------
create or replace view public.v_perda_por_motivo
with (security_invoker = true) as
select tipo_perda, sum(kg_perda) as kg
from public.apontamentos
where tipo_perda is not null and tipo_perda <> '' and kg_perda is not null
group by tipo_perda
order by kg desc;

-- ----------------------------------------------------------------------------
-- 3. Apara por classificação de produto
-- ----------------------------------------------------------------------------
create or replace view public.v_perda_por_classificacao
with (security_invoker = true) as
select
  classificacao,
  sum(kg_perda)           as kg_perda,
  sum(peso_bruto_bobina)  as peso_bruto,
  case when sum(peso_bruto_bobina) > 0
    then sum(kg_perda) / sum(peso_bruto_bobina) * 100
    else 0
  end as apara_pct
from public.apontamentos
where classificacao is not null and classificacao <> ''
group by classificacao;

-- ----------------------------------------------------------------------------
-- 4. Horas por tipo de apontamento (downtime), excluindo "Produzindo" (20)
-- ----------------------------------------------------------------------------
create or replace view public.v_downtime_por_status
with (security_invoker = true) as
select cod_apont, cod_desc, sum(qtd_horas) as horas
from public.apontamentos
where cod_apont is distinct from '20' and cod_desc is not null and cod_desc <> ''
group by cod_apont, cod_desc
order by horas desc;

-- ----------------------------------------------------------------------------
-- 5. Série mensal de aparas — apontado (fardos) e confirmado (balança)
-- ----------------------------------------------------------------------------
-- Dois filtros que existem pelo mesmo motivo: não deixar mês sem realizado
-- virar 0% na série.
--   "data <= current_date": as planilhas trazem os meses futuros do ano já
--   como linha, zerados. Sem o corte eles entravam como realizado e o KPI
--   da capa (que lê o último mês da série) mostrava 0,0%.
--   "having sum(...) > 0": o mês corrente também vem zerado até fechar, e
--   mês sem volume medido não tem percentual de apara — mostrar 0% ali
--   seria inventar número. Sem volume = o mês simplesmente não entra.
create or replace view public.v_fardos_mensal
with (security_invoker = true) as
select
  date_trunc('month', data)::date as mes,
  sum(qtd_bruta_kg)   as bruta_kg,
  sum(qtd_liquida_kg) as liquida_kg,
  (sum(qtd_bruta_kg) - sum(qtd_liquida_kg)) / sum(qtd_bruta_kg) * 100 as apara_pct
from public.fardos_aparas
where data is not null
  and data <= current_date
group by 1
having sum(qtd_bruta_kg) > 0
order by 1;

-- Mesmos dois filtros da view acima, pelo mesmo motivo: "Conta Refugo" vai
-- até dezembro do ano corrente com os meses que ainda não aconteceram
-- zerados, e o mês em curso também fica zerado até fechar.
create or replace view public.v_refugo_mensal
with (security_invoker = true) as
select
  date_trunc('month', data)::date as mes,
  sum(volume_jgr) as volume_jgr,
  sum(scrap_jgr)  as scrap_jgr,
  sum(scrap_jgr) / sum(volume_jgr) * 100 as scrap_pct
from public.refugo_aparas_historico
where data is not null
  and data <= current_date
group by 1
having sum(volume_jgr) > 0
order by 1;

-- ----------------------------------------------------------------------------
-- 6. Ordens com maior refugo (top 50)
-- ----------------------------------------------------------------------------
create or replace view public.v_ops_refugo
with (security_invoker = true) as
select
  num_ordem,
  cod_recurso,
  max(des_num_ordem) as descricao,
  sum(peso_bruto_bobina) as peso_bruto,
  sum(kg_perda) as kg_perda,
  case when sum(peso_bruto_bobina) > 0
    then sum(kg_perda) / sum(peso_bruto_bobina) * 100
    else 0
  end as apara_pct,
  mode() within group (order by tipo_perda) as motivo_principal
from public.apontamentos
where num_ordem is not null and num_ordem <> '' and peso_bruto_bobina > 0
group by num_ordem, cod_recurso
order by apara_pct desc
limit 50;

-- ----------------------------------------------------------------------------
-- 7. Linha do tempo — apontamentos do dia mais recente com dado (não é
--    "agora", é o último dia completo que a carga trouxe)
-- ----------------------------------------------------------------------------
create or replace view public.v_apontamentos_ultimo_dia
with (security_invoker = true) as
with ultimo_dia as (
  select max(dt_producao) as d from public.apontamentos where dt_producao is not null
)
select a.cod_recurso, a.cod_apont, a.cod_desc, a.hora_inicio, a.hora_fim, a.num_ordem
from public.apontamentos a, ultimo_dia
where a.dt_producao = ultimo_dia.d
  and a.hora_inicio is not null
  and a.hora_fim is not null
  and a.cod_recurso is not null
order by a.cod_recurso, a.hora_inicio;

-- ----------------------------------------------------------------------------
-- 8. Refugo por máquina (de "Refugo Produção.xlsx", aba "Consulta Perda")
--    — granularidade real por evento/máquina/motivo, complementa a visão de
--    perda por motivo (que vem de apontamentos).
-- ----------------------------------------------------------------------------
create or replace view public.v_refugo_producao_maquina
with (security_invoker = true) as
select
  maquina,
  sum(kg_perda) as kg_perda,
  mode() within group (order by tipo) as motivo_principal
from public.refugo_producao
where maquina is not null and maquina <> ''
group by maquina
order by kg_perda desc;

-- ----------------------------------------------------------------------------
-- 9. Produção/refugo em kg por mês (de "Indicadores Diário - AAAA.xlsx",
--    aba "Base Apontamentos (kg)")
-- ----------------------------------------------------------------------------
create or replace view public.v_producao_kg_mensal
with (security_invoker = true) as
select
  date_trunc('month', dt_producao)::date as mes,
  sum(peso_bruto) as peso_bruto_kg,
  sum(refugo) as refugo_kg,
  case when sum(peso_bruto) > 0
    then sum(refugo) / sum(peso_bruto) * 100
    else 0
  end as refugo_pct
from public.producao_kg
where dt_producao is not null
group by 1
order by 1;

-- ----------------------------------------------------------------------------
-- Permissões — mesma regra das tabelas: leitura só para autenticado.
-- Views com security_invoker=true precisam do GRANT explícito, mesmo já
-- tendo RLS nas tabelas de origem, porque o Postgres checa privilégio na
-- própria view também.
-- ----------------------------------------------------------------------------
grant select on
  public.v_maquinas_resumo,
  public.v_perda_por_motivo,
  public.v_perda_por_classificacao,
  public.v_downtime_por_status,
  public.v_fardos_mensal,
  public.v_refugo_mensal,
  public.v_ops_refugo,
  public.v_apontamentos_ultimo_dia,
  public.v_refugo_producao_maquina,
  public.v_producao_kg_mensal
to authenticated;
