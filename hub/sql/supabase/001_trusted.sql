-- ============================================================================
-- 001_trusted.sql — camada TRUSTED no Supabase (semana 2; ainda NÃO aplicado).
-- Rodar no SQL Editor do Supabase quando for ligar a publicação.
--
-- Só entram agregados (indicador × mês × recorte) e o status da validação.
-- Nada de nome de operador, cliente ou evento bruto.
--
-- Depois de rodar:
--   1. Settings → API → Exposed schemas: adicionar "trusted".
--   2. Auth: criar um usuário técnico só pro hub e inserir o id dele em
--      trusted.escritores. A senha vai no Cofre de Credenciais do Windows
--      (keyring), nunca em arquivo. A chave service_role NÃO fica no PC.
-- ============================================================================
create schema if not exists trusted;

create table if not exists trusted.kpi_valor (
  indicador     text not null,
  periodo       date not null,
  recorte       text not null,
  valor         numeric,
  numerador     numeric,
  denominador   numeric,
  fonte         text not null,          -- fonte oficial do indicador
  status        text not null,          -- validado | divergente | erro | desatualizado | aguardando
  execucao      integer not null,       -- processing_runs.id no hub
  atualizado_em timestamptz not null default now(),
  primary key (indicador, periodo, recorte)
);

create table if not exists trusted.validacao (
  indicador       text not null,
  periodo         date not null,
  recorte         text not null,
  fonte_oficial   text,
  valor_oficial   numeric,
  fonte_comparada text not null default '',
  valor_comparado numeric,
  dif_abs         numeric,
  dif_pct         numeric,
  status          text not null,
  motivo          text,
  execucao        integer not null,
  atualizado_em   timestamptz not null default now(),
  primary key (indicador, periodo, recorte, fonte_comparada)
);

create table if not exists trusted.saude_fonte (
  fonte          text primary key,
  status         text not null,          -- ok | desatualizado | erro | aguardando
  lido_em        timestamptz,
  dado_ate       date,
  linhas         bigint,
  mensagem       text,
  atualizado_em  timestamptz not null default now()
);

-- Quem pode escrever: só o usuário técnico do hub.
create table if not exists trusted.escritores (user_id uuid primary key);
alter table trusted.escritores enable row level security;  -- sem policy: fechada pela API
revoke all on trusted.escritores from anon, authenticated;

-- security definer: a policy consulta escritores mesmo com RLS fechada nela.
create or replace function trusted.eh_escritor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from trusted.escritores where user_id = auth.uid());
$$;
revoke all on function trusted.eh_escritor() from public;
grant execute on function trusted.eh_escritor() to authenticated;

do $$ declare t text; begin
  foreach t in array array['kpi_valor', 'validacao', 'saude_fonte'] loop
    execute format('alter table trusted.%I enable row level security', t);
    execute format('drop policy if exists leitura on trusted.%I', t);
    execute format('create policy leitura on trusted.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists escrita_hub on trusted.%I', t);
    execute format('create policy escrita_hub on trusted.%I for all to authenticated
                    using (trusted.eh_escritor()) with check (trusted.eh_escritor())', t);
    execute format('grant select, insert, update, delete on trusted.%I to authenticated', t);
  end loop;
end $$;

grant usage on schema trusted to authenticated;
