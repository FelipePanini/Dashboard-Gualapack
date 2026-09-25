-- ============================================================================
-- 001_metadados.sql — estrutura do banco local (DuckDB). Roda a cada execução
-- (tudo "if not exists"), então pode ser reaplicado sem perder nada.
--
-- As relações ficam comentadas em vez de FOREIGN KEY: o DuckDB tem
-- restrições para UPDATE em linhas referenciadas, e processing_runs recebe
-- UPDATE no fim de toda execução.
--
--   processing_runs 1──* files *──1 sources
--   processing_runs 1──* errors
--   processing_runs 1──* measurements *──1 indicators (codigo + versao)
--   processing_runs 1──* validation_results (compara measurements da execução)
-- ============================================================================

create schema if not exists raw;     -- cópia fiel da última versão boa de cada fonte
create schema if not exists clean;   -- tipos, códigos e recortes padronizados
create schema if not exists cfg;     -- parâmetros vindos de config/*.yaml

create sequence if not exists seq_execucao;
create sequence if not exists seq_arquivo;

create table if not exists processing_runs (
  id            integer primary key default nextval('seq_execucao'),
  started_at    timestamp not null default current_timestamp,
  finished_at   timestamp,
  status        varchar not null default 'rodando',  -- rodando | ok | parcial | erro
  gatilho       varchar,                              -- agendado | manual | teste
  versao_codigo varchar                               -- commit do git
);

create table if not exists sources (
  id            varchar primary key,                  -- 'indicadores.base_apontamento'
  tipo          varchar not null,                     -- excel_tabela | excel_bloco | sql_view | manual
  descricao     varchar,
  dono          varchar,
  frescor_dias  integer not null default 1,           -- atraso máximo aceito do dado (0 = histórico, não confere)
  ativa         boolean not null default true
);  -- o caminho do arquivo fica só em config/fontes.local.yaml

create table if not exists files (
  id                 integer primary key default nextval('seq_arquivo'),
  source_id          varchar not null,                -- sources.id
  run_id             integer not null,                -- processing_runs.id
  caminho            varchar not null,
  sha256             varchar not null,
  config_hash        varchar,                         -- muda quando a regra de leitura muda
  assinatura_origem  varchar,                         -- nome+tamanho+data de gravação: igual = nem copia
  tamanho_bytes      bigint,
  modificado_em      timestamp,
  linhas             bigint,
  assinatura_colunas varchar,                         -- muda quando o cabeçalho muda
  dado_de            date,
  dado_ate           date,
  status             varchar not null                 -- novo | sem_mudanca | contrato_quebrado | erro
);
-- bancos criados antes da coluna existir (24/09)
alter table files add column if not exists assinatura_origem varchar;

create table if not exists indicators (
  codigo            varchar not null,
  versao            integer not null,
  nome              varchar not null,
  unidade           varchar not null,                 -- pct | kg | h
  grao              varchar not null,                 -- 'mes x recorte'
  definicao         varchar not null,                 -- o texto que o dono assina
  regra_sql         varchar not null,                 -- arquivos de regra, separados por ';'
  fonte_oficial     varchar not null,                 -- sources.id ou 'hub.calculo'
  fontes_comparadas varchar,                          -- ids separados por ',' (nulo = fonte única)
  comparacao_opcional boolean default false,          -- a comparada só existe em alguns períodos
  tolerancia_abs    double,
  tolerancia_pct    double,
  dono              varchar,
  status_definicao  varchar,                          -- rascunho | em_validacao | oficial
  primary key (codigo, versao)
);
alter table indicators add column if not exists comparacao_opcional boolean default false;
alter table indicators add column if not exists correcao varchar;  -- onde e o que corrigir quando divergir
alter table indicators add column if not exists faixa_max double;  -- teto da faixa em %, se não for 100 (aderência passa de 100)

create table if not exists measurements (
  run_id      integer not null,
  indicador   varchar not null,
  versao      integer not null,
  source_id   varchar not null,                       -- fonte, ou 'hub.calculo'
  file_id     integer,                                -- versão do arquivo (quando é uma fonte só)
  periodo     date not null,                          -- início do período
  recorte     varchar not null,                       -- 'Flexo', 'R18', 'TOTAL'
  valor       double,
  numerador   double,                                 -- componentes somáveis, quando existem
  denominador double,
  dado_ate    date,                                   -- até quando as fontes usadas têm dado
  linhagem    json,                                   -- regra → fontes → arquivo → sha256
  primary key (run_id, indicador, source_id, periodo, recorte)
);

create table if not exists validation_results (
  run_id          integer not null,
  indicador       varchar not null,
  periodo         date not null,
  recorte         varchar not null,
  fonte_oficial   varchar,
  valor_oficial   double,
  fonte_comparada varchar,
  valor_comparado double,
  dif_abs         double,
  dif_pct         double,
  status          varchar not null,  -- validado | divergente | erro | desatualizado | aguardando
  motivo          varchar
);

create table if not exists errors (
  run_id     integer not null,
  source_id  varchar,
  file_id    integer,
  gravidade  varchar not null,                        -- erro | aviso
  codigo     varchar not null,                        -- contrato_quebrado | arquivo_ausente | ...
  mensagem   varchar not null,
  contexto   json,
  criado_em  timestamp default current_timestamp
);

-- Meses de cada série por dia já publicados no Supabase (publicacao.CONJUNTOS).
-- A assinatura é o md5 do conteúdo do mês: só vai de novo o mês que mudou.
-- "uv run hub publicar" limpa esta tabela e reenvia tudo.
drop table if exists publicacao_horas;  -- versão só com as horas (até 25/09)
create table if not exists publicacao_mes (
  conjunto     varchar not null,
  mes          date not null,
  assinatura   varchar not null,
  publicado_em timestamp default current_timestamp,
  primary key (conjunto, mes)
);

create or replace table cfg.meses as
select * from (values
  ('janeiro', 1), ('fevereiro', 2), ('marco', 3), ('abril', 4), ('maio', 5), ('junho', 6),
  ('julho', 7), ('agosto', 8), ('setembro', 9), ('outubro', 10), ('novembro', 11), ('dezembro', 12)
) t(nome, num);

-- Saúde de cada fonte: última leitura, até quando vai o dado e se está atrasada.
create or replace view v_saude_fonte as
with ultima as (
  select * from files qualify row_number() over (partition by source_id order by id desc) = 1
), ultima_boa as (
  select * from files where status = 'novo'
  qualify row_number() over (partition by source_id order by id desc) = 1
), erros_ultima_execucao as (
  select distinct source_id from errors
  where gravidade = 'erro' and run_id = (select max(id) from processing_runs)
)
select s.id as fonte, s.tipo, s.frescor_dias, s.dono,
       u.status                as ultima_leitura,
       r.started_at            as lido_em,
       u.modificado_em         as arquivo_salvo_em,
       b.dado_ate, b.linhas,
       case
         when e.source_id is not null or u.status in ('contrato_quebrado', 'erro') then 'erro'
         when u.status is null                                                      then 'aguardando'
         when s.frescor_dias > 0 and b.dado_ate < current_date - s.frescor_dias      then 'desatualizado'
         else 'ok'
       end as status
from sources s
left join ultima u                on u.source_id = s.id
left join processing_runs r       on r.id = u.run_id
left join ultima_boa b            on b.source_id = s.id
left join erros_ultima_execucao e on e.source_id = s.id
where s.ativa;
