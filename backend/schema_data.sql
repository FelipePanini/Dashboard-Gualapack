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
--
--    Retenção: sync.js/ingest só gravam linhas com dt_producao dentro dos
--    últimos 12 meses (RETENTION_MONTHS) — planilhas antigas (ex: "Base
--    Aparas - 2024.xlsx") são lidas mas descartadas na carga, pra não
--    estourar o limite de armazenamento do plano free do Supabase de novo.
--
--    Sem chave natural nas linhas (é um log de eventos), então a carga
--    troca por arquivo: antes de inserir as linhas de um arquivo, apaga as
--    linhas que aquele MESMO arquivo gravou da vez anterior (por
--    _source_file) e insere as novas. Sem isso, rodar o sync todo dia sem
--    nenhuma chave de conflito faz cada linha ser inserida de novo do zero
--    a cada execução — foi exatamente isso que estourou o banco.
-- ----------------------------------------------------------------------------
create table if not exists public.apontamentos (
  id                  bigint generated always as identity primary key,
  _source_file        text,          -- nome do arquivo que gravou a linha (ver comentário acima)
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
  nome_cliente         text,
  -- Só existem na aba [Base Apontamento] (fonte do TMR desde 2026-09-10).
  -- classificacao_disp: PLANEJADO / IMPRODUTIVO / PRODUZINDO — é a
  -- classificação oficial de disponibilidade da própria origem. Hoje o TMR
  -- ainda é calculado por cod_apont = '20'; as duas concordam (48.888
  -- eventos PRODUZINDO x 48.830 com cod_apont '20' em 2026), então a coluna
  -- fica gravada para conferência antes de virar a regra do cálculo.
  classificacao_disp   text,
  classificacao_horas  text
);

-- Migração para bancos que já têm a tabela criada (idempotente).
alter table public.apontamentos add column if not exists classificacao_disp  text;
alter table public.apontamentos add column if not exists classificacao_horas text;

create index if not exists idx_apontamentos_data on public.apontamentos (dt_producao desc);
create index if not exists idx_apontamentos_recurso on public.apontamentos (cod_recurso, dt_producao desc);
create index if not exists idx_apontamentos_source on public.apontamentos (_source_file);

-- ----------------------------------------------------------------------------
-- 3. Fardos de aparas — um por fardo (de "SEQUENCIAMENTO DOS FARDOS DE
--    APARAS JGR" mensal e "Sequenciamento Acumulado")
--    Mesma troca-por-arquivo da tabela apontamentos (ver comentário lá).
-- ----------------------------------------------------------------------------
create table if not exists public.fardos_aparas (
  id              bigint generated always as identity primary key,
  _source_file    text,          -- nome do arquivo que gravou a linha
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
create index if not exists idx_fardos_aparas_source on public.fardos_aparas (_source_file);

-- ----------------------------------------------------------------------------
-- 4. Aderência — apontamentos de produção por máquina/dia (de "Aderência
--    Máquinas - Diária", aba "Apontamentos_produção")
--    Mesma troca-por-arquivo e retenção de 12 meses da tabela apontamentos.
-- ----------------------------------------------------------------------------
create table if not exists public.aderencia_maquinas_diaria (
  id             bigint generated always as identity primary key,
  _source_file   text,          -- nome do arquivo que gravou a linha
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
create index if not exists idx_aderencia_maq_source on public.aderencia_maquinas_diaria (_source_file);

-- ----------------------------------------------------------------------------
-- 5. Aderência à programação (de "Histórico Aderência Programação")
--    Mesma retenção de 12 meses e troca-por-arquivo da tabela apontamentos
--    (por dt_saida_maquina / _source_file).
-- ----------------------------------------------------------------------------
create table if not exists public.aderencia_programacao (
  id                bigint generated always as identity primary key,
  _source_file      text,          -- nome do arquivo que gravou a linha
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
create index if not exists idx_aderencia_prog_source on public.aderencia_programacao (_source_file);

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
-- 6b. Refugo por evento/máquina/motivo (de "Refugo Produção.xlsx", aba
--     "Consulta Perda") — log de evento, sem chave natural, mesma troca-
--     por-arquivo e retenção de 12 meses da tabela apontamentos.
-- ----------------------------------------------------------------------------
create table if not exists public.refugo_producao (
  id            bigint generated always as identity primary key,
  _source_file  text,
  op            text,
  maquina       text,
  turno         numeric,
  dt_producao   date,
  cod_apont     text,
  operador      text,
  processo      text,
  tipo          text,     -- motivo do refugo, ex: '05_Acerto_de_Cor'
  kg_perda      numeric,
  dia           numeric,
  chave_1       text,
  mes           numeric
);

create index if not exists idx_refugo_producao_data on public.refugo_producao (dt_producao desc);
create index if not exists idx_refugo_producao_source on public.refugo_producao (_source_file);

-- ----------------------------------------------------------------------------
-- 6c. Produção/refugo em kg por ordem (de "Indicadores Diário - AAAA.xlsx",
--     aba "Base Apontamentos (kg)") — separado de "apontamentos" (que vem
--     da aba "Base Máquina_Embalagem" e tem os campos de TMR/Gantt/parada).
--     Mesma troca-por-arquivo e retenção de 12 meses.
-- ----------------------------------------------------------------------------
create table if not exists public.producao_kg (
  id            bigint generated always as identity primary key,
  _source_file  text,
  num_ordem     text,
  cod_recurso   text,
  dt_producao   date,
  turno         text,
  peso_bruto    numeric,
  refugo        numeric,
  descricao     text,
  estrutura     text,
  processo      text,
  tipo_produto  text,
  considerar    text,
  planta        text,
  maquina_real  text,
  chave         text
);

create index if not exists idx_producao_kg_data on public.producao_kg (dt_producao desc);
create index if not exists idx_producao_kg_source on public.producao_kg (_source_file);

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
alter table public.refugo_producao            enable row level security;
alter table public.producao_kg                enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'maquinas','apontamentos','fardos_aparas','aderencia_maquinas_diaria',
    'aderencia_programacao','refugo_aparas_historico','tendencia_mensal',
    'refugo_producao','producao_kg'
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
