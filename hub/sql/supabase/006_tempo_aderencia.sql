-- ============================================================================
-- 006_tempo_aderencia.sql — linha do tempo por dia de produção, aderência do
-- BI (página Ad. Plan Mensal) e a apara confirmada do mês em andamento
-- (07/10/2026). Rodar no SQL Editor do Supabase DEPOIS do 001 a 005. Pode
-- rodar de novo sem problema.
--
--   evento_dia  eventos de cada um dos últimos 14 dias de produção (06:00 às
--               06:00 do dia seguinte), um dia por publicação, só o que mudou
--   plano_dia   planejado (Histórico Aderência Programação) x realizado
--               (apontamentos, como a Produção Metros do BI) por máquina e dia
--   apara_mes.volume_jgr / scrap_jgr / volume_total  as colunas da Refugo
--               Aparas (Conta Refugo): a apara confirmada de cada mês passa a
--               ser a "% JGR" da planilha, scrap_jgr ÷ (volume_jgr +
--               scrap_jgr); período de mais de um mês e o acumulado do ano
--               seguem o bloco ACUMULADO (YTD) da planilha, scrap total ÷
--               (volume total + scrap total) (decisões de 08/10/2026)
-- Leitura só pra quem está logado (RLS), como as outras tabelas do hub.
-- ============================================================================

create table if not exists trusted.evento_dia (
  dia          date not null,               -- dia de produção (06:00 às 06:00)
  maquina      text not null,
  cod_apont    text not null,
  hora_inicio  timestamp not null,          -- hora da fábrica, sem fuso
  hora_fim     timestamp not null,
  num_ordem    text
);
create index if not exists evento_dia_dia on trusted.evento_dia (dia);

create table if not exists trusted.plano_dia (
  dia        date not null,
  maquina    text not null,
  planejado  numeric,                        -- metros (QtdPlanejada)
  realizado  numeric,                        -- metros (QtdProduzida)
  primary key (dia, maquina)
);

alter table trusted.apara_mes add column if not exists volume_jgr numeric;
alter table trusted.apara_mes add column if not exists scrap_jgr numeric;
alter table trusted.apara_mes add column if not exists volume_total numeric;

do $$ declare t text; begin
  foreach t in array array['evento_dia', 'plano_dia'] loop
    execute format('alter table trusted.%I enable row level security', t);
    execute format('drop policy if exists leitura on trusted.%I', t);
    execute format('create policy leitura on trusted.%I for select to authenticated using (true)', t);
    execute format('grant select on trusted.%I to authenticated', t);
  end loop;
end $$;

-- Publicação (versão 4): tudo da versão 3 (005) e mais plano_dia e evento_dia.
create or replace function public.hub_publicar(dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_validacao integer := 0;
  n integer := 0;
  de date;
  ate date;
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
  if dados ? 'codigos' then
    delete from trusted.codigo_apontamento where true;
    insert into trusted.codigo_apontamento
    select * from jsonb_populate_recordset(null::trusted.codigo_apontamento, dados->'codigos');
  end if;
  if dados ? 'ultimo_dia' then
    delete from trusted.apontamento_ultimo_dia where true;
    insert into trusted.apontamento_ultimo_dia
    select * from jsonb_populate_recordset(null::trusted.apontamento_ultimo_dia, dados->'ultimo_dia');
  end if;
  if dados ? 'apara_mes' then
    delete from trusted.apara_mes where true;
    insert into trusted.apara_mes select * from jsonb_populate_recordset(null::trusted.apara_mes, dados->'apara_mes');
  end if;
  -- fotos do estado atual (005)
  if dados ? 'agora' then
    delete from trusted.maquina_agora where true;
    insert into trusted.maquina_agora select * from jsonb_populate_recordset(null::trusted.maquina_agora, dados->'agora');
  end if;
  if dados ? 'programacao' then
    delete from trusted.programacao where true;
    insert into trusted.programacao select * from jsonb_populate_recordset(null::trusted.programacao, dados->'programacao');
  end if;
  if dados ? 'wip' then
    delete from trusted.wip where true;
    insert into trusted.wip select * from jsonb_populate_recordset(null::trusted.wip, dados->'wip');
  end if;
  if dados ? 'carteira' then
    delete from trusted.carteira where true;
    insert into trusted.carteira select * from jsonb_populate_recordset(null::trusted.carteira, dados->'carteira');
  end if;
  if dados ? 'carteira_mes' then
    delete from trusted.carteira_mes where true;
    insert into trusted.carteira_mes select * from jsonb_populate_recordset(null::trusted.carteira_mes, dados->'carteira_mes');
  end if;

  if dados ? 'conjunto' then
    de := (dados->>'de')::date;
    ate := (dados->>'ate')::date;
    if de is null or ate is null then
      raise exception 'conjunto % sem intervalo (de/ate)', dados->>'conjunto';
    end if;
    case dados->>'conjunto'
      when 'horas_maquina_dia' then
        delete from trusted.horas_maquina_dia where dia between de and ate;
        insert into trusted.horas_maquina_dia
        select * from jsonb_populate_recordset(null::trusted.horas_maquina_dia, dados->'linhas');
      when 'apara_dia' then
        delete from trusted.apara_dia where dia between de and ate;
        insert into trusted.apara_dia
        select * from jsonb_populate_recordset(null::trusted.apara_dia, dados->'linhas');
      when 'perda_dia' then
        delete from trusted.perda_dia where dia between de and ate;
        insert into trusted.perda_dia
        select * from jsonb_populate_recordset(null::trusted.perda_dia, dados->'linhas');
      when 'aderencia_dia' then
        delete from trusted.aderencia_dia where dia between de and ate;
        insert into trusted.aderencia_dia
        select * from jsonb_populate_recordset(null::trusted.aderencia_dia, dados->'linhas');
      when 'kg_maquina_dia' then
        delete from trusted.kg_maquina_dia where dia between de and ate;
        insert into trusted.kg_maquina_dia
        select * from jsonb_populate_recordset(null::trusted.kg_maquina_dia, dados->'linhas');
      when 'm2_maquina_dia' then
        delete from trusted.m2_maquina_dia where dia between de and ate;
        insert into trusted.m2_maquina_dia
        select * from jsonb_populate_recordset(null::trusted.m2_maquina_dia, dados->'linhas');
      when 'entrega_dia' then
        delete from trusted.entrega_dia where dia between de and ate;
        insert into trusted.entrega_dia
        select * from jsonb_populate_recordset(null::trusted.entrega_dia, dados->'linhas');
      when 'setup_dia' then
        delete from trusted.setup_dia where dia between de and ate;
        insert into trusted.setup_dia
        select * from jsonb_populate_recordset(null::trusted.setup_dia, dados->'linhas');
      when 'laudo_dia' then
        delete from trusted.laudo_dia where dia between de and ate;
        insert into trusted.laudo_dia
        select * from jsonb_populate_recordset(null::trusted.laudo_dia, dados->'linhas');
      when 'faturamento_dia' then
        delete from trusted.faturamento_dia where dia between de and ate;
        insert into trusted.faturamento_dia
        select * from jsonb_populate_recordset(null::trusted.faturamento_dia, dados->'linhas');
      -- 006
      when 'plano_dia' then
        delete from trusted.plano_dia where dia between de and ate;
        insert into trusted.plano_dia
        select * from jsonb_populate_recordset(null::trusted.plano_dia, dados->'linhas');
      when 'evento_dia' then
        -- guarda só as últimas semanas: a linha do tempo mostra os últimos 14 dias
        delete from trusted.evento_dia where dia between de and ate or dia < current_date - 40;
        insert into trusted.evento_dia
        select * from jsonb_populate_recordset(null::trusted.evento_dia, dados->'linhas');
      else
        raise exception 'conjunto desconhecido: %', dados->>'conjunto';
    end case;
    get diagnostics n = row_count;
    return jsonb_build_object('conjunto', dados->>'conjunto', 'linhas', n);
  end if;

  return jsonb_build_object('validacao', n_validacao, 'versao', 4);
end;
$$;
revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Leitura pelo painel
-- ---------------------------------------------------------------------------
-- Eventos de um dia (o painel filtra por dia) e os dias que existem.
-- Mesmo formato do v_hub_ultimo_dia (001), mais o dia de produção.
create or replace view public.v_hub_eventos with (security_invoker = true) as
  select e.dia, e.maquina as cod_recurso, e.cod_apont, c.descricao as cod_desc,
         e.hora_inicio, e.hora_fim, e.num_ordem
  from trusted.evento_dia e
  left join trusted.codigo_apontamento c on c.cod = e.cod_apont;
create or replace view public.v_hub_eventos_dias with (security_invoker = true) as
  select dia, count(*)::integer as eventos from trusted.evento_dia group by dia order by dia desc;
revoke all on public.v_hub_eventos, public.v_hub_eventos_dias from public, anon;
grant select on public.v_hub_eventos, public.v_hub_eventos_dias to authenticated;

-- Planejado x realizado por máquina no período (Ad. Plan Mensal do BI). Com o
-- mês em andamento, planejado_ate_hoje é o que já devia ter sido feito ("hoje"
-- no fuso da fábrica: o banco do Supabase roda em UTC, 3 h na frente).
create or replace function public.rpc_hub_plano(p_de date default null, p_ate date default null)
returns table(maquina text, planejado numeric, planejado_ate_hoje numeric, realizado numeric)
language sql stable security invoker set search_path = '' as $$
  select maquina, sum(planejado),
         coalesce(sum(planejado) filter (where dia <= (now() at time zone 'America/Sao_Paulo')::date), 0),
         sum(realizado)
  from trusted.plano_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1 order by 1;
$$;
revoke all on function public.rpc_hub_plano(date, date) from public, anon;
grant execute on function public.rpc_hub_plano(date, date) to authenticated;

-- O mesmo por mês: linhas de tendência e comparação com o mês anterior dos
-- cartões da Aderência.
create or replace view public.v_hub_plano_mensal with (security_invoker = true) as
  select date_trunc('month', dia)::date as mes, sum(planejado) as planejado, sum(realizado) as realizado
  from trusted.plano_dia
  group by 1 order by 1;
revoke all on public.v_hub_plano_mensal from public, anon;
grant select on public.v_hub_plano_mensal to authenticated;

-- Apara apontada e confirmada no período (como no 003). Mudança: a
-- confirmada segue a Conta Refugo da Refugo Aparas.
--   um mês:          a "% JGR", scrap JGR ÷ (volume JGR + scrap JGR)
--   mais de um mês:  como o ACUMULADO (YTD) da planilha, scrap total ÷
--                    (volume total + scrap total), JGR + ORF
-- A VOLUME JGR vai só até o último dia pesado. Mês sem a planilha: a conta do
-- BI, scrap total ÷ (peso bruto das REBs + scrap total).
create or replace function public.rpc_hub_apara_periodo(p_de date default null, p_ate date default null)
returns table(refugo numeric, peso_bruto_rebs numeric, scrap_total numeric,
              apontado_pct numeric, confirmado_pct numeric)
language sql stable security invoker set search_path = '' as $$
  with a as (
    select coalesce(sum(refugo), 0) as refugo,
           coalesce(sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')), 0) as pb
    from trusted.apara_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  ), pm as (   -- peso bruto das REBs de cada mês dentro do período
    select date_trunc('month', dia)::date as mes,
           sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')) as pb
    from trusted.apara_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
    group by 1
  ), s as (
    select count(m.scrap_total)                         as meses,
           sum(coalesce(m.scrap_jgr, m.scrap_total))   as scrap_jgr,
           sum(coalesce(m.volume_jgr, pm.pb, 0))       as base_jgr,
           sum(m.scrap_total)                          as scrap_tot,
           sum(coalesce(m.volume_total, pm.pb, 0))     as base_tot
    from trusted.apara_mes m left join pm using (mes)
    where (p_de is null or m.mes >= p_de) and (p_ate is null or m.mes < p_ate)
  )
  select a.refugo, a.pb,
         case when s.meses > 1 then s.scrap_tot else s.scrap_jgr end,
         100 * a.refugo / nullif(a.refugo + a.pb, 0),
         case when s.meses > 1 then 100 * s.scrap_tot / nullif(s.base_tot + s.scrap_tot, 0)
              else 100 * s.scrap_jgr / nullif(s.base_jgr + s.scrap_jgr, 0) end
  from a, s;
$$;

-- Série mensal do gráfico de apara: a confirmada é a "% JGR" da planilha
-- (scrap_total aqui é o scrap JGR, o da conta).
create or replace view public.v_hub_apara_mensal with (security_invoker = true) as
  select mes, refugo, peso_bruto_rebs, coalesce(scrap_jgr, scrap_total) as scrap_total,
         100 * refugo / nullif(refugo + peso_bruto_rebs, 0) as apontado_pct,
         100 * coalesce(scrap_jgr, scrap_total)
             / nullif(coalesce(volume_jgr, peso_bruto_rebs) + coalesce(scrap_jgr, scrap_total), 0) as confirmado_pct
  from trusted.apara_mes
  order by mes;
grant select on public.v_hub_apara_mensal to authenticated;

-- Acumulado de cada ano, como o bloco ACUMULADO da Conta Refugo (YTD 2025,
-- YTD 2026): scrap total ÷ (volume total + scrap total). Conferido em
-- 08/10/2026: 2025 = 13,46% (4.744.431,1 kg e 737.975,4 kg), 2026 = 14,28%.
create or replace view public.v_hub_apara_ano with (security_invoker = true) as
  select extract(year from mes)::integer as ano, max(mes) as ate_mes,
         sum(volume_total) as producao, sum(scrap_total) as scrap,
         100 * sum(scrap_total) / nullif(sum(volume_total) + sum(scrap_total), 0) as confirmado_pct
  from trusted.apara_mes
  where volume_total > 0
  group by 1
  order by 1;
revoke all on public.v_hub_apara_ano from public, anon;
grant select on public.v_hub_apara_ano to authenticated;

-- Conferência: tem de devolver funcoes_ok = true.
select count(*) = 3 as funcoes_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('hub_publicar', 'rpc_hub_plano', 'rpc_hub_apara_periodo')
  and (p.proname <> 'hub_publicar' or pg_get_functiondef(p.oid) like '%evento_dia%');
