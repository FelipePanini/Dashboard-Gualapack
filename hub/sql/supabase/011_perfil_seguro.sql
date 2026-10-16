-- =============================================================================
-- 011_perfil_seguro.sql (16/10/2026): o perfil de acesso só muda pelo SQL Editor
-- =============================================================================
-- A policy "profiles: usuário edita o próprio perfil" (backend/sql/schema.sql)
-- deixa cada usuário atualizar a própria linha de public.profiles, e isso vale
-- para todas as colunas, inclusive role. Qualquer conta logada podia se tornar
-- administrador chamando a API do Supabase direto, sem passar pelo painel. Daí
-- ela ganharia a tela de acessos, as chaves de convite, as metas e o "Ajustar
-- planta", que conferem o papel no banco.
--
-- Nenhuma tela do painel altera o perfil (todas só leem, e o cadastro grava pela
-- Edge Function com a chave de serviço). Por isso o usuário logado passa a poder
-- mudar só o próprio nome. Perfil (role), área e data de cadastro mudam só
-- pelo SQL Editor (que roda como dono do banco e não depende destas permissões)
-- ou por uma função de administrador.
--
-- Rodar inteiro no SQL Editor do Supabase. Pode rodar de novo sem problema.

revoke update on table public.profiles from authenticated, anon;
grant update (full_name) on table public.profiles to authenticated;

-- Conferência: tem de devolver perfil_ok = true.
select not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
   and not has_column_privilege('authenticated', 'public.profiles', 'area', 'UPDATE')
   and has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as perfil_ok;
