-- ============================================================================
-- Painel de Produção Gualapack — schema dos dados operacionais (versão final)
-- Alvo: Supabase (Postgres 15+). Rode depois de schema.sql, uma única vez.
--
-- Estas tabelas são o destino da carga diária feita pela Edge Function
-- "sync-daily" (ver backend/functions/sync-daily). O front-end (demo/index.html)
-- passa a ler daqui em vez dos arrays fixos hoje embutidos no JS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Máquinas — catálogo + snapshot diário de indicadores
-- ----------------------------------------------------------------------------
create table if not exists public.maquinas (
  id          text primary key,           -- ex: 'REB01', 'L02', 'R12'
  nome        text not null,
  processo    text not null check (processo in ('Impressão','Laminação','Corte','Refile','OF','Coating')),
  rota        text not null default 'SEM IMPRESSÃO' check (rota in ('FLEXO','ROTO','SEM IMPRESSÃO')),
  grupo       text,                       -- 'GRUPO 1'..'GRUPO 4' (Grupo Máquinas do BI)
  vel_ref     numeric,                    -- velocidade de referência (m/min)
  ordem       int not null default 0      -- ordem de exibição (espelha o eixo do Gantt no BI)
);

-- Snapshot: uma linha por máquina por dia. É o que alimenta TMR, velocidade,
-- apara e aderência do dia — mantém histórico em vez de sobrescrever.
create table if not exists public.maquinas_diario (
  id              bigint generated always as identity primary key,
  data_ref        date not null default current_date,
  maquina_id      text not null references public.maquinas(id),
  tmr             numeric,      -- Tempo de Máquina Rodando (%)
  vel_media       numeric,      -- m/min
  aparas_pct      numeric,      -- % apontada
  perda_confirm_pct numeric,    -- % confirmada (balança)
  horas_prod      numeric,
  horas_tot       numeric,
  plan_km         numeric,      -- planejado (aderência)
  real_km         numeric,      -- realizado (aderência)
  unique (data_ref, maquina_id)
);

create index if not exists idx_maquinas_diario_data on public.maquinas_diario (data_ref desc);

-- ----------------------------------------------------------------------------
-- 2. Perda por motivo — série diária
-- ----------------------------------------------------------------------------
create table if not exists public.perdas_diario (
  id          bigint generated always as identity primary key,
  data_ref    date not null default current_date,
  tipo_perda  text not null,     -- ex: '01_Falha_Impressao'
  maquina_id  text references public.maquinas(id),
  kg          numeric not null default 0,
  unique (data_ref, tipo_perda, maquina_id)
);

create index if not exists idx_perdas_diario_data on public.perdas_diario (data_ref desc);

-- ----------------------------------------------------------------------------
-- 3. Ordens de produção (refugo por OP, tabela "Ordens com maior refugo")
-- ----------------------------------------------------------------------------
create table if not exists public.ops_diario (
  id            bigint generated always as identity primary key,
  data_ref      date not null default current_date,
  op            text not null,
  maquina_id    text references public.maquinas(id),
  descricao     text,
  peso_bruto_kg numeric,
  refugo_kg     numeric,
  apara_pct     numeric,
  motivo_principal text,
  unique (data_ref, op)
);

-- ----------------------------------------------------------------------------
-- 4. WIP e carteira
-- ----------------------------------------------------------------------------
create table if not exists public.wip_diario (
  id          bigint generated always as identity primary key,
  data_ref    date not null default current_date,
  etapa       text not null,     -- 'IMPRESSO','WIP INTERMEDIÁRIO','CORTE','PAPEL','PRE CORTE','FINAL'
  cliente     text,
  classificacao text,
  dentro_carteira boolean not null default true,  -- DC / FC
  metros      numeric not null default 0
);

create index if not exists idx_wip_diario_data on public.wip_diario (data_ref desc);

create table if not exists public.carteira_diario (
  id            bigint generated always as identity primary key,
  data_ref      date not null default current_date,
  classificacao text not null,
  carteira_kg   numeric not null default 0,
  produzido_kg  numeric not null default 0,
  faturado_kg   numeric not null default 0,
  unique (data_ref, classificacao)
);

-- ----------------------------------------------------------------------------
-- 5. Apontamentos (linha do tempo / Gantt) — janela móvel de 48h é suficiente
-- ----------------------------------------------------------------------------
create table if not exists public.apontamentos (
  id          bigint generated always as identity primary key,
  maquina_id  text not null references public.maquinas(id),
  status      text not null,     -- 'Produzindo','Parada Produtiva', etc.
  op          text,
  inicio      timestamptz not null,
  fim         timestamptz
);

create index if not exists idx_apontamentos_janela on public.apontamentos (maquina_id, inicio desc);

-- ----------------------------------------------------------------------------
-- 6. RLS — leitura para qualquer usuário autenticado, escrita só via
--    service_role (a Edge Function de carga, nunca o navegador).
-- ----------------------------------------------------------------------------
alter table public.maquinas          enable row level security;
alter table public.maquinas_diario   enable row level security;
alter table public.perdas_diario     enable row level security;
alter table public.ops_diario        enable row level security;
alter table public.wip_diario        enable row level security;
alter table public.carteira_diario   enable row level security;
alter table public.apontamentos      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['maquinas','maquinas_diario','perdas_diario','ops_diario','wip_diario','carteira_diario','apontamentos']
  loop
    execute format(
      'create policy "%1$s: leitura por usuário autenticado" on public.%1$s for select to authenticated using (true);',
      t
    );
  end loop;
end $$;

-- Nenhuma policy de insert/update/delete para authenticated/anon — só
-- service_role (que ignora RLS por padrão) consegue escrever, ou seja, só a
-- Edge Function "sync-daily" grava dado novo.

-- ----------------------------------------------------------------------------
-- 7. Log da carga diária — pra você conferir se rodou e o que veio
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

create policy "sync_log: admin lê o histórico de carga"
  on public.sync_log for select
  to authenticated
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );
