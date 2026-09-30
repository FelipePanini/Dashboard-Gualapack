-- ============================================================================
-- 003_conferencia.sql — o que faltava pro painel bater com o BI em tudo.
-- Rodar no SQL Editor do Supabase depois do 002. Pode rodar de novo.
-- Não precisa de "uv run hub publicar": só lê o que o hub já publica.
--
-- Achados da conferência de 30/09 (motor do BI x painel, out/25 a set/26):
--   * os cartões de apara mostravam sempre o último mês, em qualquer período;
--     no BI eles seguem o período escolhido -> rpc_hub_apara_periodo
--   * as linhas de tendência dos cartões e o "TMR — últimos 12 meses" do
--     detalhe da máquina eram desenhados ao acaso -> rpc_hub_mensal
--   * o refugo por motivo no detalhe da máquina era o total repartido em
--     proporções fixas -> rpc_hub_perda_maquina_motivo
-- ============================================================================

-- Apara apontada e confirmada no período (medidas do BI: % Apontada_Geral
-- REBS e % PerdaConfirm. TOTAL). O scrap da balança é mensal e fica no dia 1º
-- do mês, como a tabela Perda Aparas no BI: entra o mês cujo dia 1º cai no
-- período.
create or replace function public.rpc_hub_apara_periodo(p_de date default null, p_ate date default null)
returns table(refugo numeric, peso_bruto_rebs numeric, scrap_total numeric,
              apontado_pct numeric, confirmado_pct numeric)
language sql stable security invoker set search_path = '' as $$
  with a as (
    select coalesce(sum(refugo), 0) as refugo,
           coalesce(sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')), 0) as pb
    from trusted.apara_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  ), s as (
    select sum(scrap_total) as scrap from trusted.apara_mes
    where (p_de is null or mes >= p_de) and (p_ate is null or mes < p_ate)
  )
  select a.refugo, a.pb, s.scrap,
         100 * a.refugo / nullif(a.refugo + a.pb, 0),
         100 * s.scrap / nullif(a.pb + s.scrap, 0)
  from a, s;
$$;

-- Por mês e máquina, os últimos p_meses meses (inclusive o corrente): a série
-- real das linhas de tendência dos cartões e do detalhe da máquina.
create or replace function public.rpc_hub_mensal(p_meses integer default 12)
returns table(mes date, maquina text, horas_totais numeric, horas_produzindo numeric, metros numeric,
              planejado numeric, produzido numeric, m2 numeric, horas_m2 numeric, perda_kg numeric)
language sql stable security invoker set search_path = '' as $$
  with ini as (select (date_trunc('month', current_date) - make_interval(months => greatest(p_meses, 1) - 1))::date as d),
  h as (
    select date_trunc('month', dia)::date as mes, maquina,
           sum(horas) filter (where classe not in ('FIM TURNO', 'INATIVIDADE')) as tot,
           sum(horas) filter (where classe = 'PRODUZINDO') as prod, sum(metros) as metros
    from trusted.horas_maquina_dia, ini where dia >= ini.d group by 1, 2
  ), ad as (
    select date_trunc('month', dia)::date as mes, maquina, sum(planejado) as plan, sum(produzido) as prod
    from trusted.aderencia_dia, ini where dia >= ini.d group by 1, 2
  ), m2 as (
    select date_trunc('month', dia)::date as mes, maquina, sum(m2) as m2, sum(horas) as horas
    from trusted.m2_maquina_dia, ini where dia >= ini.d group by 1, 2
  ), p as (
    select date_trunc('month', dia)::date as mes, maquina, sum(kg) as kg
    from trusted.perda_dia, ini where dia >= ini.d group by 1, 2
  ), chaves as (
    select mes, maquina from h union select mes, maquina from ad
    union select mes, maquina from m2 union select mes, maquina from p
  )
  select c.mes, c.maquina, coalesce(h.tot, 0), coalesce(h.prod, 0), coalesce(h.metros, 0),
         coalesce(ad.plan, 0), coalesce(ad.prod, 0), coalesce(m2.m2, 0), coalesce(m2.horas, 0), coalesce(p.kg, 0)
  from chaves c
  left join h using (mes, maquina) left join ad using (mes, maquina)
  left join m2 using (mes, maquina) left join p using (mes, maquina)
  order by 1, 2;
$$;

-- Perda por máquina e motivo no período (detalhe da máquina).
create or replace function public.rpc_hub_perda_maquina_motivo(p_de date default null, p_ate date default null)
returns table(maquina text, tipo text, kg numeric)
language sql stable security invoker set search_path = '' as $$
  select maquina, case when tipo = '' then 'Sem motivo informado' else tipo end, sum(kg)
  from trusted.perda_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1, 2
  order by 1, 3 desc;
$$;

revoke all on function public.rpc_hub_apara_periodo(date, date), public.rpc_hub_mensal(integer),
                       public.rpc_hub_perda_maquina_motivo(date, date) from public, anon;
grant execute on function public.rpc_hub_apara_periodo(date, date), public.rpc_hub_mensal(integer),
                          public.rpc_hub_perda_maquina_motivo(date, date) to authenticated;

-- Conferência: tem de devolver funcoes_ok = true.
select count(*) = 3 as funcoes_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rpc_hub_apara_periodo', 'rpc_hub_mensal', 'rpc_hub_perda_maquina_motivo');
