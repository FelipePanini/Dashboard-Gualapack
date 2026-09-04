-- ============================================================================
-- Painel de Produção Gualapack — schema dos dados operacionais REAIS
-- Alvo: Supabase (Postgres 15+). Rode depois de schema.sql, uma única vez.
--
-- Tabelas espelhando a estrutura das planilhas reais da produção (ver pasta
-- do Google Drive compartilhada) — não são mais um modelo fictício. Cada
-- tabela corresponde a uma aba/arquivo de origem; ver backend/README-dados.md
-- para o mapeamento planilha -> tabela -> colunas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Máquinas — catálogo (de "Machine Card Oficial")
-- ----------------------------------------------------------------------------
create table if not exists public.maquinas (
  id          text primary key,     -- ex: 'REB 01', 'R18', 'L02'
  grupo       text,                 -- 'CORTADEIRAS', 'FLEXOGRAFIA', 'LAMINADORAS', 'COATING', 'ROTOGRAVURA', 'HOT MELT'...
  considerar  text                  -- 'S' / 'N' (como vem na planilha)
);

-- ----------------------------------------------------------------------------
-- 2. Apontamentos — eventos brutos de produção (de "Indicadores Diário" /
--    "Base Aparas"). É a maior e mais importante tabela — cada linha é um
--    evento de máquina (produzindo, parada, refugo, setup...).
-- ----------------------------------------------------------------------------
create table if not exists public.apontamentos (
  id                  bigint generated always as identity primary key,
  num_ordem           text,
  cod_recurso         text,
  cod_apont           text,          -- código do tipo de apontamento (ex: '20', '40')
  cod_desc            text,          -- descrição do apontamento (ex: '20 - Produzindo')
  dt_producao         date,
  hora_inicio         timestamptz,
  hora_fim            timestamptz,
  qtd_horas           numeric,
  qtd_produzida       numeric,
  turno               text,
  desperdicio_acerto  numeric,
  desperdicio_virando numeric,
  peso_bruto_bobina   numeric,
  tipo_perda          text,          -- usr_tipodaperda (ex: '06_Falha_de_Laminaca')
  kg_perda            numeric,       -- usr_kgdaperda
  nome_operador       text,
  tipo_produto        text,
  cod_estrutura       text,
  des_num_ordem       text,          -- descrição do produto/ordem
  cod_est             text,
  processo            text,          -- 'Impressão', 'Laminação', 'Corte'...
  classificacao       text,          -- família de produto
  nome_cliente         text
);

create index if not exists idx_apontamentos_data on public.apontamentos (dt_producao desc);
create index if not exists idx_apontamentos_recurso on public.apontamentos (cod_recurso, dt_producao desc);

-- ----------------------------------------------------------------------------
-- 3. Fardos de aparas — um por fardo (de "SEQUENCIAMENTO DOS FARDOS DE
--    APARAS JGR" mensal e "Sequenciamento Acumulado")
-- ----------------------------------------------------------------------------
create table if not exists public.fardos_aparas (
  id              bigint generated always as identity primary key,
  codigo          text,          -- código da classificação (numérico, ex: '1', '11')
  dp_fp           text,          -- 'DP' ou 'FP'
  refugo          text,          -- 'X' ou vazio
  refile          text,          -- 'X' ou vazio
  data            date,
  numero          int,           -- Nº do fardo no dia
  qtd_bruta_kg    numeric,
  qtd_liquida_kg  numeric,
  nome            text,          -- operador
  classificacao   text,          -- texto da classificação (ex: 'PROCESSO PRODUTIVO', 'REFILE')
  tipo            text
);

create index if not exists idx_fardos_aparas_data on public.fardos_aparas (data desc);

-- ----------------------------------------------------------------------------
-- 4. Aderência — apontamentos de produção por máquina/dia (de "Aderência
--    Máquinas - Diária", aba "Apontamentos_produção")
-- ----------------------------------------------------------------------------
create table if not exists public.aderencia_maquinas_diaria (
  id             bigint generated always as identity primary key,
  num_ordem      text,
  dt_producao    date,
  qtd_produzida  numeric,
  cod_recurso    text,
  qtd_horas      numeric,
  classificacao  text,
  descricao      text,
  cod_estrutura  text,
  turno          text,
  cod_desc       text,
  cod_apont      text
);

create index if not exists idx_aderencia_maq_data on public.aderencia_maquinas_diaria (dt_producao desc);

-- ----------------------------------------------------------------------------
-- 5. Aderência à programação (de "Histórico Aderência Programação")
-- ----------------------------------------------------------------------------
create table if not exists public.aderencia_programacao (
  id                bigint generated always as identity primary key,
  cod_cliente       text,
  cod_estrutura     text,
  recurso_ctr       text,
  tipo_produto      text,
  num_ordem         text,
  dt_saida_maquina  timestamptz,
  descricao         text,
  cliente           text,
  atividade         text,
  qtd_produzido     numeric,
  qtd_planejado     numeric,
  meta_qtd_acerto   numeric,
  qtd_acerto_real   numeric,
  min_set_prog      numeric,
  min_set_real      numeric,
  qtd_prod_kg       numeric,
  meta_mts_hora     numeric,
  qtd_hor_p         numeric,
  cilindro          text
);

create index if not exists idx_aderencia_prog_data on public.aderencia_programacao (dt_saida_maquina desc);

-- ----------------------------------------------------------------------------
-- 6. Refugo/aparas — série histórica mensal (de "Refugo Aparas")
-- ----------------------------------------------------------------------------
create table if not exists public.refugo_aparas_historico (
  id          bigint generated always as identity primary key,
  data        date not null,
  volume_jgr  numeric,
  scrap_jgr   numeric,
  volume_orf  numeric,
  scrap_orf   numeric,
  unique (data)
);

-- ----------------------------------------------------------------------------
-- 7. Tendência mensal — pré-agregado (de "Graficos Tendência")
-- ----------------------------------------------------------------------------
create table if not exists public.tendencia_mensal (
  id                   bigint generated always as identity primary key,
  mes                  text not null,  -- ex: 'Janeiro', 'W-27'
  ano                  int,
  volume_prod_corte_km numeric,
  lote_medio_km        numeric,
  volume_prod_kg       numeric,
  aparas_kg            numeric,
  aparas_pct           numeric,
  unique (mes, ano)
);

-- ----------------------------------------------------------------------------
-- 8. RLS — leitura para qualquer usuário autenticado, escrita só via
--    service_role (a função "ingest", nunca o navegador direto).
-- ----------------------------------------------------------------------------
alter table public.maquinas                   enable row level security;
alter table public.apontamentos               enable row level security;
alter table public.fardos_aparas              enable row level security;
alter table public.aderencia_maquinas_diaria  enable row level security;
alter table public.aderencia_programacao      enable row level security;
alter table public.refugo_aparas_historico    enable row level security;
alter table public.tendencia_mensal           enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'maquinas','apontamentos','fardos_aparas','aderencia_maquinas_diaria',
    'aderencia_programacao','refugo_aparas_historico','tendencia_mensal'
  ]
  loop
    -- drop antes de criar pra esse script poder ser rodado de novo sem
    -- erro de "policy already exists" (create policy não tem IF NOT EXISTS)
    execute format('drop policy if exists "%1$s: leitura por usuário autenticado" on public.%1$s;', t);
    execute format(
      'create policy "%1$s: leitura por usuário autenticado" on public.%1$s for select to authenticated using (true);',
      t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 9. Log da carga — pra conferir se um upload rodou e o que veio
-- ----------------------------------------------------------------------------
create table if not exists public.sync_log (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running','ok','error')),
  detalhe     text,
  linhas_gravadas int
);

alter table public.sync_log enable row level security;

drop policy if exists "sync_log: admin lê o histórico de carga" on public.sync_log;

create policy "sync_log: admin lê o histórico de carga"
  on public.sync_log for select
  to authenticated
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );
