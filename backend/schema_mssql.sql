-- ============================================================================
-- schema_mssql.sql — tabelas alimentadas direto do SQL Server (Metrics),
-- via o runner self-hosted em backend/sync-mssql/. Rode uma vez no SQL
-- Editor do Supabase antes de rodar o sync pela primeira vez.
--
-- Diferente das tabelas de backend/schema_data.sql (que vêm de planilha e
-- usam troca-por-arquivo via "_source_file"), estas vêm de consulta SQL
-- direta — sem "arquivo", a troca é por JANELA DE DATA: o sync apaga o
-- que estiver dentro da janela de retenção e grava de novo a cada rodada
-- (ver RETENTION_MONTHS em sync-mssql/lib.js). "_synced_at" registra
-- quando cada linha foi gravada, útil pra auditoria.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Produção em m² por OP/máquina/dia — de Machine Card [Produção].
--    É a única fonte com largura real: sem ela o KPI de produtividade
--    (m²/h) do painel fica vazio. Fonte: dbo.View_usr_apontamentos_999999
--    + dbo.EstrProcessos (largura), Sql.Database("sbrjag-db...", "Metrics").
-- ----------------------------------------------------------------------------
create table if not exists public.producao_metros (
  id                 bigint generated always as identity primary key,
  _synced_at         timestamptz not null default now(),
  num_ordem          text,
  cod_recurso        text,
  dt_producao        date,
  tipo_produto       text,
  descricao          text,
  operador           text,
  turno              numeric,
  qtd_horas          numeric,
  qtd_produzida_m    numeric,   -- "Qtd Produzida (Metros)"
  producao_m2        numeric,   -- calculado: qtd_produzida_m * (largura_real / 1000)
  largura_real       numeric,
  cod_estrutura      text       -- "Cód. Métrics"
);

create index if not exists idx_producao_metros_data on public.producao_metros (dt_producao desc);
create index if not exists idx_producao_metros_recurso on public.producao_metros (cod_recurso, dt_producao desc);

-- ----------------------------------------------------------------------------
-- 2. Programação futura/planejada por OP/máquina — de Aderência Semanal
--    [Programação Futuro]. É o que falta pro Gantt e pra Aderência: hoje
--    o painel só tem o REALIZADO (apontamentos); isto é o PLANEJADO.
--    Fonte: Sql.Database("sbrjag-db...", "Metrics",
--    "Select * from View_usr_programacao_teruel").
-- ----------------------------------------------------------------------------
create table if not exists public.programacao_futura (
  id                 bigint generated always as identity primary key,
  _synced_at         timestamptz not null default now(),
  num_ordem          text,
  maquina            text,      -- CodRecurso, com espaços aparados
  produto             text,
  qtd_planejada      numeric,
  dt_ini_plan        timestamptz
);

create index if not exists idx_programacao_futura_data on public.programacao_futura (dt_ini_plan desc);
create index if not exists idx_programacao_futura_maquina on public.programacao_futura (maquina, dt_ini_plan desc);

-- ----------------------------------------------------------------------------
-- 3. RLS — mesmo padrão do schema_data.sql: leitura pra autenticado,
--    escrita só via service_role.
-- ----------------------------------------------------------------------------
alter table public.producao_metros    enable row level security;
alter table public.programacao_futura enable row level security;

drop policy if exists "producao_metros: leitura por usuário autenticado" on public.producao_metros;
create policy "producao_metros: leitura por usuário autenticado"
  on public.producao_metros for select to authenticated using (true);

drop policy if exists "programacao_futura: leitura por usuário autenticado" on public.programacao_futura;
create policy "programacao_futura: leitura por usuário autenticado"
  on public.programacao_futura for select to authenticated using (true);
