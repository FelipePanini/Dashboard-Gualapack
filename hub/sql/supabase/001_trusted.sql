-- ============================================================================
-- 001_trusted.sql — camada TRUSTED no Supabase: o que o hub publica.
-- Rodar no SQL Editor do Supabase DEPOIS de criar o usuário técnico
-- (hub/scripts/criar_usuario_hub.py): a última linha autoriza esse usuário.
-- Pode rodar de novo sem problema (tudo "if not exists" / "or replace").
--
-- Só entram agregados e metadados: fontes (sem caminho de arquivo),
-- catálogo de indicadores, resultado da validação, avisos da execução e
-- horas por máquina/dia/classe. Nada de nome de operador ou de cliente.
--
-- Escrita: só pela função public.hub_publicar(jsonb), chamada pelo usuário
-- técnico do hub (cadastrado em trusted.escritores). A função troca os dados
-- numa transação só — o painel nunca vê publicação pela metade.
-- Leitura: views public.v_hub_* para quem está logado no painel (RLS).
-- ============================================================================
create schema if not exists trusted;

create table if not exists trusted.execucao (
  id            integer primary key,          -- processing_runs.id no hub
  iniciada_em   timestamptz,
  terminada_em  timestamptz,
  status        text,
  publicada_em  timestamptz not null default now()
);

create table if not exists trusted.fonte (
  fonte            text primary key,
  tipo             text,
  descricao        text,
  dono             text,
  status           text not null,             -- ok | desatualizado | erro | aguardando
  lido_em          timestamptz,
  arquivo_salvo_em timestamptz,
  dado_ate         date,
  linhas           bigint,
  frescor_dias     integer
);

create table if not exists trusted.indicador (
  codigo            text primary key,
  versao            integer,
  nome              text,
  unidade           text,
  grao              text,
  definicao         text,
  fonte_oficial     text,
  fontes_comparadas text,
  tolerancia_abs    numeric,
  tolerancia_pct    numeric,
  status_definicao  text,
  notas             text
);

create table if not exists trusted.validacao (
  indicador        text not null,
  periodo          date not null,
  recorte          text not null,
  fonte_oficial    text,
  valor_oficial    numeric,
  fonte_comparada  text not null default '',
  valor_comparado  numeric,
  dif_abs          numeric,
  dif_pct          numeric,
  status           text not null,             -- validado | divergente | erro | desatualizado | aguardando
  motivo           text,
  correcao         text,                      -- onde corrigir, quando a causa é célula de planilha
  primary key (indicador, periodo, recorte, fonte_comparada)
);

create table if not exists trusted.aviso (
  id        bigint generated always as identity primary key,
  gravidade text,
  fonte     text,
  codigo    text,
  mensagem  text
);

-- Horas por máquina, dia e classe oficial (dado completo do BI). Base do TMR.
create table if not exists trusted.horas_maquina_dia (
  dia      date not null,
  maquina  text not null,
  classe   text not null,                     -- PRODUZINDO | SETUP | INICIALIZACAO | IMPRODUTIVO | INATIVIDADE | FIM TURNO | SEM CLASSIFICACAO
  horas    numeric not null,
  primary key (dia, maquina, classe)
);

-- Quem pode publicar (fechada pela API: RLS ligada e nenhuma policy).
create table if not exists trusted.escritores (user_id uuid primary key);

do $$ declare t text; begin
  foreach t in array array['execucao', 'fonte', 'indicador', 'validacao', 'aviso', 'horas_maquina_dia', 'escritores'] loop
    execute format('alter table trusted.%I enable row level security', t);
  end loop;
  foreach t in array array['execucao', 'fonte', 'indicador', 'validacao', 'aviso', 'horas_maquina_dia'] loop
    execute format('drop policy if exists leitura on trusted.%I', t);
    execute format('create policy leitura on trusted.%I for select to authenticated using (true)', t);
    execute format('grant select on trusted.%I to authenticated', t);
  end loop;
end $$;
grant usage on schema trusted to authenticated;
revoke all on trusted.escritores from anon, authenticated;

-- Publicação: troca o conteúdo das tabelas que vierem no pacote.
create or replace function public.hub_publicar(dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_validacao integer := 0;
  n_horas integer := 0;
begin
  if not exists (select 1 from trusted.escritores where user_id = auth.uid()) then
    raise exception 'sem permissão para publicar dados do hub' using errcode = '42501';
  end if;

  if dados ? 'execucao' then
    insert into trusted.execucao (id, iniciada_em, terminada_em, status)
    select (dados->'execucao'->>'id')::integer, (dados->'execucao'->>'iniciada_em')::timestamptz,
           (dados->'execucao'->>'terminada_em')::timestamptz, dados->'execucao'->>'status'
    on conflict (id) do update set iniciada_em = excluded.iniciada_em, terminada_em = excluded.terminada_em,
                                   status = excluded.status, publicada_em = now();
  end if;

  if dados ? 'fontes' then
    delete from trusted.fonte where true;
    insert into trusted.fonte select * from jsonb_populate_recordset(null::trusted.fonte, dados->'fontes');
  end if;

  if dados ? 'indicadores' then
    delete from trusted.indicador where true;
    insert into trusted.indicador select * from jsonb_populate_recordset(null::trusted.indicador, dados->'indicadores');
  end if;

  if dados ? 'validacao' then
    delete from trusted.validacao where true;
    insert into trusted.validacao select * from jsonb_populate_recordset(null::trusted.validacao, dados->'validacao');
    get diagnostics n_validacao = row_count;
  end if;

  if dados ? 'avisos' then
    delete from trusted.aviso where true;
    insert into trusted.aviso (gravidade, fonte, codigo, mensagem)
    select gravidade, fonte, codigo, mensagem from jsonb_populate_recordset(null::trusted.aviso, dados->'avisos');
  end if;

  -- horas: troca só o intervalo de datas enviado (o hub manda um mês por vez)
  if dados ? 'horas_maquina_dia' then
    delete from trusted.horas_maquina_dia
    where dia between (dados->>'horas_de')::date and (dados->>'horas_ate')::date;
    insert into trusted.horas_maquina_dia
    select * from jsonb_populate_recordset(null::trusted.horas_maquina_dia, dados->'horas_maquina_dia');
    get diagnostics n_horas = row_count;
  end if;

  return jsonb_build_object('validacao', n_validacao, 'horas', n_horas);
end;
$$;
revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- Leitura pelo painel.
create or replace view public.v_hub_execucao with (security_invoker = true) as
  select * from trusted.execucao order by id desc limit 1;
create or replace view public.v_hub_fontes with (security_invoker = true) as
  select * from trusted.fonte;
create or replace view public.v_hub_indicadores with (security_invoker = true) as
  select * from trusted.indicador;
create or replace view public.v_hub_validacao with (security_invoker = true) as
  select * from trusted.validacao;
create or replace view public.v_hub_avisos with (security_invoker = true) as
  select gravidade, fonte, codigo, mensagem from trusted.aviso;
grant select on public.v_hub_execucao, public.v_hub_fontes, public.v_hub_indicadores,
                public.v_hub_validacao, public.v_hub_avisos to authenticated;

-- Autoriza o usuário técnico do hub a publicar (e-mail de config/fontes.local.yaml).
insert into trusted.escritores (user_id)
select id from auth.users where email = 'hub-dados@painel-gualapack.invalid'
on conflict do nothing;

-- Conferência: precisa devolver 1 linha. Se vier vazio, o usuário técnico
-- ainda não foi criado — rode o script e depois só este insert de novo.
select u.email, e.user_id is not null as autorizado
from auth.users u left join trusted.escritores e on e.user_id = u.id
where u.email = 'hub-dados@painel-gualapack.invalid';
