-- ============================================================================
-- Painel de Produção Gualapack — schema de autenticação e controle de acesso
-- Alvo: Supabase (Postgres 15+). Rode este arquivo inteiro no SQL Editor do
-- seu projeto Supabase (Project > SQL Editor > New query) uma única vez.
-- ============================================================================

-- No Supabase, pgcrypto normalmente é instalado no schema "extensions",
-- não em "public" — por isso toda função abaixo que usa crypt()/gen_salt()
-- precisa incluir "extensions" no seu search_path explicitamente, senão
-- funciona no SQL Editor (que enxerga tudo) mas falha quando chamada via
-- API/RPC com search_path restrito.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Perfis de usuário (dados públicos ligados a auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null default 'viewer' check (role in ('viewer','supervisor','manager','admin')),
  area        text not null default 'Produção',
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada usuário autenticado só lê o próprio perfil e os perfis de outros
-- usuários da mesma empresa (necessário pra listar quem está no painel).
create policy "profiles: leitura por qualquer usuário autenticado"
  on public.profiles for select
  to authenticated
  using (true);

-- Ninguém edita perfil de terceiros; o próprio dono pode atualizar o nome.
create policy "profiles: usuário edita o próprio perfil"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Inserção de perfil só acontece via função server-side (security definer),
-- nunca diretamente pelo cliente — por isso não existe policy de INSERT aqui.

-- ----------------------------------------------------------------------------
-- 2. Chaves de convite (cadastro fechado)
-- ----------------------------------------------------------------------------
-- A chave em texto puro NUNCA é armazenada — só o hash (pgcrypto/bf).
-- max_uses permite gerar uma chave "de equipe" reutilizável N vezes, ou
-- uma chave de uso único (max_uses = 1).
create table if not exists public.invite_keys (
  id          uuid primary key default gen_random_uuid(),
  key_hash    text not null,
  label       text not null,
  role        text not null default 'viewer' check (role in ('viewer','supervisor','manager','admin')),
  max_uses    int not null default 1 check (max_uses > 0),
  used_count  int not null default 0 check (used_count >= 0),
  expires_at  timestamptz,
  revoked     boolean not null default false,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

alter table public.invite_keys enable row level security;

-- Ninguém lê/edita a tabela de convites diretamente pelo cliente — nem
-- sequer autenticado. Toda a lógica passa pela função abaixo (security
-- definer) chamada só a partir do Edge Function de cadastro, que usa a
-- service role key (nunca exposta ao navegador).
-- (Sem nenhuma policy = acesso negado por padrão para authenticated/anon.)

-- Só admins conseguem listar convites, via policy explícita.
create policy "invite_keys: admin lista convites"
  on public.invite_keys for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Função de validação + consumo atômico da chave de convite
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER: roda com os privilégios do dono da função (não do
-- chamador), então consegue ler/atualizar invite_keys mesmo sem policy de
-- SELECT/UPDATE para o público. Só deve ser chamada pelo Edge Function
-- "register", nunca exposta como RPC pública sem essa proteção.
create or replace function public.validate_and_consume_invite(plain_key text)
returns table (valid boolean, invite_id uuid, granted_role text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  match_row record;
begin
  -- Busca a primeira chave ativa cujo hash bate com a chave enviada.
  select ik.id, ik.role, ik.max_uses, ik.used_count, ik.expires_at, ik.revoked
    into match_row
    from public.invite_keys ik
    where ik.key_hash = crypt(plain_key, ik.key_hash)
      and ik.revoked = false
      and ik.used_count < ik.max_uses
      and (ik.expires_at is null or ik.expires_at > now())
    limit 1;

  if match_row.id is null then
    return query select false, null::uuid, null::text;
    return;
  end if;

  -- Incremento atômico — impede corrida entre dois cadastros simultâneos
  -- consumindo a mesma chave além do limite (max_uses).
  update public.invite_keys
    set used_count = used_count + 1
    where id = match_row.id
      and used_count < max_uses;

  if not found then
    return query select false, null::uuid, null::text;
    return;
  end if;

  return query select true, match_row.id, match_row.role;
end;
$$;

-- Revoga acesso público direto à função — só o service role (Edge Function)
-- deve conseguir chamá-la. REVOKE FROM PUBLIC remove o EXECUTE implícito
-- que toda função ganha ao ser criada — isso também tira o acesso do
-- service_role (ele não é superuser), então precisa ser devolvido
-- explicitamente na linha seguinte, senão a Edge Function fica sem
-- conseguir chamar a própria função de validação.
revoke execute on function public.validate_and_consume_invite(text) from public, anon, authenticated;
grant execute on function public.validate_and_consume_invite(text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Helper para você gerar chaves de convite pelo SQL Editor
-- ----------------------------------------------------------------------------
-- Exemplo de uso (troque 'chave-aqui' por uma chave forte e única):
--
--   insert into public.invite_keys (key_hash, label, role, max_uses, expires_at)
--   values (
--     crypt('chave-aqui', gen_salt('bf')),
--     'Convite - Supervisores Turno A',
--     'supervisor',
--     5,
--     now() + interval '30 days'
--   );
--
-- Depois de rodar, ANOTE a chave em texto puro em local seguro (ex: 1Password)
-- e mande para quem for se cadastrar — ela não pode ser recuperada depois,
-- só o hash fica salvo no banco.

-- ----------------------------------------------------------------------------
-- 5. Índices úteis
-- ----------------------------------------------------------------------------
create index if not exists idx_invite_keys_active
  on public.invite_keys (revoked, expires_at)
  where revoked = false;
