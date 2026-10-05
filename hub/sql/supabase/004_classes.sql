-- 004_classes.sql — classe oficial de cada código de apontamento, pra o painel.
--
-- O painel pinta as paradas pela classificação oficial do código
-- (Classificação_Apontamentos: PRODUZINDO, SETUP, INICIALIZACAO, IMPRODUTIVO,
-- INATIVIDADE, FIM TURNO, SEM CLASSIFICACAO), com a mesma cor no Gantt, nas
-- horas de parada e no Pareto. O hub já publica essa tabela
-- (trusted.codigo_apontamento, 001_trusted.sql); faltava só a leitura pela API.
-- Sem esta view o painel funciona igual, com as paradas numa cor só.
--
-- Só leitura, para quem está logado (mesma regra das outras views do hub).
-- Rodar uma vez no SQL Editor do Supabase, depois do 001–003.

create or replace view public.v_hub_codigos with (security_invoker = true) as
  select cod, descricao, classe from trusted.codigo_apontamento;

revoke all on public.v_hub_codigos from public, anon;
grant select on public.v_hub_codigos to authenticated;
