-- ============================================================================
-- 002_cartoes.sql — o painel inteiro lendo do hub, com as regras do BI
-- Indicadores Produção. Rodar no SQL Editor do Supabase DEPOIS do 001.
-- Pode rodar de novo sem problema. Depois de rodar: "uv run hub publicar".
--
-- O hub publica fatos por dia (horas, apara, perda, aderência, produção) e
-- estas funções somam no período que o painel pede (p_de/p_ate, p_ate
-- EXCLUSIVO, como as rpc_* do painel). Só agregados: nada de operador,
-- cliente ou observação.
--
-- Regras (as mesmas medidas do BI, conferidas mês a mês na página Qualidade):
--   TMR          = horas PRODUZINDO ÷ horas sem FIM TURNO e sem INATIVIDADE
--   velocidade   = metros ÷ horas PRODUZINDO ÷ 60
--   apontado     = refugo ÷ (refugo + peso bruto das REBs pela MÁQUINA REAL)
--   confirmado   = scrap total ÷ (peso bruto das REBs + scrap total)
--   aderência    = produzido ÷ planejado (mês de início planejado)
-- ============================================================================

-- Horas por máquina/dia/código com a classe do Machine Card (tabela Horas)
-- e os metros. A versão do 001 (sem classe e metros) sai: o hub reenvia tudo.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'trusted' and table_name = 'horas_maquina_dia')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'trusted' and table_name = 'horas_maquina_dia' and column_name = 'metros') then
    drop table trusted.horas_maquina_dia;
  end if;
end $$;
create table if not exists trusted.horas_maquina_dia (
  dia        date not null,
  maquina    text not null,
  cod_apont  text not null,
  cod_desc   text,
  classe     text not null default '',        -- '' = sem classificação (conta no total, como no BI)
  horas      numeric not null default 0,
  metros     numeric not null default 0,
  primary key (dia, maquina, cod_apont, classe)
);

-- Peso bruto e refugo por OP/máquina/dia (BASE_PROD do Base Aparas).
create table if not exists trusted.apara_dia (
  dia           date not null,
  maquina       text not null,
  maquina_real  text,
  num_ordem     text,
  descricao     text,
  grupos        text[] not null default '{}', -- classificações do BI (Sylvamo, Bula & Paper...)
  peso_bruto    numeric not null default 0,
  refugo        numeric not null default 0
);
create index if not exists apara_dia_dia on trusted.apara_dia (dia);

-- Perda apontada (código 40) por OP/máquina/dia/tipo (BASE_DETALHE do Base Aparas).
create table if not exists trusted.perda_dia (
  dia        date not null,
  maquina    text not null,
  num_ordem  text not null default '',
  tipo       text not null default '',
  kg         numeric not null,
  primary key (dia, maquina, num_ordem, tipo)
);

-- Programado x produzido por OP/máquina/dia de início planejado (ADERENCIA_BI).
create table if not exists trusted.aderencia_dia (
  dia        date not null,
  maquina    text not null,
  num_ordem  text not null default '',
  planejado  numeric not null default 0,
  produzido  numeric not null default 0,
  primary key (dia, maquina, num_ordem)
);

-- Peso bruto e refugo por máquina/dia (aba Base Apontamentos (kg) do
-- Indicadores Diário): a apara de cada máquina no detalhe do painel.
create table if not exists trusted.kg_maquina_dia (
  dia         date not null,
  maquina     text not null,
  peso_bruto  numeric not null default 0,
  refugo      numeric not null default 0,
  primary key (dia, maquina)
);

-- m² e horas por máquina/dia (aba Produção (Metros) do Machine Card): produtividade.
create table if not exists trusted.m2_maquina_dia (
  dia      date not null,
  maquina  text not null,
  m2       numeric not null default 0,
  horas    numeric not null default 0,
  primary key (dia, maquina)
);

-- Apara por mês (série do gráfico e cartão de apara).
create table if not exists trusted.apara_mes (
  mes              date primary key,
  refugo           numeric,
  peso_bruto_rebs  numeric,
  scrap_total      numeric
);

do $$ declare t text; begin
  foreach t in array array['horas_maquina_dia', 'apara_dia', 'perda_dia', 'aderencia_dia',
                           'kg_maquina_dia', 'm2_maquina_dia', 'apara_mes'] loop
    execute format('alter table trusted.%I enable row level security', t);
    execute format('drop policy if exists leitura on trusted.%I', t);
    execute format('create policy leitura on trusted.%I for select to authenticated using (true)', t);
    execute format('grant select on trusted.%I to authenticated', t);
  end loop;
end $$;

-- Publicação: além do pacote do 001, séries por dia, um mês por chamada:
--   {"conjunto": "horas_maquina_dia", "de": "2026-08-01", "ate": "2026-08-31", "linhas": [...]}
-- Troca só o intervalo enviado, numa transação. Devolve quantas linhas entraram:
-- o hub confere e, se não bater, não marca o mês como publicado.
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
      else
        raise exception 'conjunto desconhecido: %', dados->>'conjunto';
    end case;
    get diagnostics n = row_count;
    return jsonb_build_object('conjunto', dados->>'conjunto', 'linhas', n);
  end if;

  return jsonb_build_object('validacao', n_validacao, 'versao', 2);
end;
$$;
revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- Por máquina no período: TMR, velocidade, apara, aderência, produtividade.
drop function if exists public.rpc_hub_maquinas(date, date);
create function public.rpc_hub_maquinas(p_de date default null, p_ate date default null)
returns table(maquina text, horas_totais numeric, horas_produzindo numeric, metros numeric,
              velocidade_ref_m_min numeric, peso_bruto numeric, refugo numeric,
              planejado numeric, produzido numeric, m2 numeric, horas_m2 numeric, dado_ate date)
language sql stable security invoker set search_path = '' as $$
  with h as (
    select maquina,
           sum(horas) filter (where classe not in ('FIM TURNO', 'INATIVIDADE')) as tot,
           sum(horas) filter (where classe = 'PRODUZINDO')                      as prod,
           sum(metros)                                                          as metros,
           max(dia)                                                             as ate
    from trusted.horas_maquina_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
    group by 1
  ), mes as (    -- velocidade de referência: o melhor mês da máquina nos 12 meses até o fim do período
    select maquina, sum(metros) / nullif(60 * sum(horas) filter (where classe = 'PRODUZINDO'), 0) as vel
    from trusted.horas_maquina_dia
    where dia >= coalesce(p_ate, current_date + 1) - interval '12 months' and dia < coalesce(p_ate, current_date + 1)
    group by maquina, date_trunc('month', dia)
  ), ref as (select maquina, max(vel) as vel_ref from mes group by 1
  ), kg as (
    select maquina, sum(peso_bruto) as peso_bruto, sum(refugo) as refugo from trusted.kg_maquina_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate) group by 1
  ), ad as (
    select maquina, sum(planejado) as planejado, sum(produzido) as produzido from trusted.aderencia_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate) group by 1
  ), m2 as (
    select maquina, sum(m2) as m2, sum(horas) as horas from trusted.m2_maquina_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate) group by 1
  ), maquinas as (
    select maquina from h union select maquina from kg union select maquina from ad union select maquina from m2
  )
  select m.maquina, coalesce(h.tot, 0), coalesce(h.prod, 0), coalesce(h.metros, 0), ref.vel_ref,
         coalesce(kg.peso_bruto, 0), coalesce(kg.refugo, 0), coalesce(ad.planejado, 0), coalesce(ad.produzido, 0),
         coalesce(m2.m2, 0), coalesce(m2.horas, 0), h.ate
  from maquinas m
  left join h using (maquina) left join ref using (maquina) left join kg using (maquina)
  left join ad using (maquina) left join m2 using (maquina);
$$;

-- Paradas: tudo que não é PRODUZINDO, por código (Machine Card).
create or replace function public.rpc_hub_paradas(p_de date default null, p_ate date default null)
returns table(cod_apont text, cod_desc text, horas numeric)
language sql stable security invoker set search_path = '' as $$
  select cod_apont, coalesce(max(cod_desc), cod_apont), sum(horas)
  from trusted.horas_maquina_dia
  where classe <> 'PRODUZINDO'
    and (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by cod_apont
  order by 3 desc;
$$;

-- Perda por motivo (gráfico Perda por Motivos do BI). Perda sem tipo
-- apontado também entra (o total bate com o BI), com esse nome.
create or replace function public.rpc_hub_perda_motivo(p_de date default null, p_ate date default null)
returns table(tipo text, kg numeric)
language sql stable security invoker set search_path = '' as $$
  select case when tipo = '' then 'Sem motivo informado' else tipo end, sum(kg) from trusted.perda_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1 order by 2 desc;
$$;

-- Perda por máquina, com o motivo que mais pesou.
create or replace function public.rpc_hub_refugo_maquina(p_de date default null, p_ate date default null)
returns table(maquina text, kg numeric, motivo_principal text)
language sql stable security invoker set search_path = '' as $$
  with p as (
    select maquina, tipo, sum(kg) as kg from trusted.perda_dia
    where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate) group by 1, 2
  )
  select maquina, sum(kg), (array_agg(tipo order by kg desc))[1] from p group by 1 order by 2 desc;
$$;

-- OPs com mais refugo (tabela da página Apontado_Cliente do BI).
create or replace function public.rpc_hub_ops_refugo(p_de date default null, p_ate date default null)
returns table(num_ordem text, maquina text, descricao text, peso_bruto numeric, refugo numeric,
              apara_pct numeric, motivo_principal text)
language sql stable security invoker set search_path = '' as $$
  with a as (
    select num_ordem, maquina, max(descricao) as descricao,
           sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')) as pb,
           sum(refugo) as refugo
    from trusted.apara_dia
    where num_ordem is not null and (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
    group by 1, 2
  ), op as (
    select num_ordem, (array_agg(maquina order by refugo desc))[1] as maquina, max(descricao) as descricao,
           coalesce(sum(pb), 0) as pb, sum(refugo) as refugo
    from a group by 1
  ), motivo as (
    select num_ordem, (array_agg(tipo order by kg desc))[1] as tipo
    from (select num_ordem, tipo, sum(kg) as kg from trusted.perda_dia
          where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate) group by 1, 2) x
    group by 1
  )
  select op.num_ordem, op.maquina, op.descricao, op.pb, op.refugo,
         100 * op.refugo / nullif(op.refugo + op.pb, 0), motivo.tipo
  from op left join motivo using (num_ordem)
  where op.refugo > 0
  order by op.refugo desc
  limit 50;
$$;

-- Apara apontada por classificação de produto (página Aparas_Geral v3 do BI).
create or replace function public.rpc_hub_classificacao(p_de date default null, p_ate date default null)
returns table(grupo text, refugo numeric, peso_bruto_rebs numeric, apara_pct numeric)
language sql stable security invoker set search_path = '' as $$
  select g, sum(refugo),
         coalesce(sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')), 0),
         100 * sum(refugo) / nullif(sum(refugo) + coalesce(sum(peso_bruto) filter (
           where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')), 0), 0)
  from trusted.apara_dia, unnest(grupos) as g
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1 order by 1;
$$;

revoke all on function public.rpc_hub_maquinas(date, date), public.rpc_hub_paradas(date, date),
                       public.rpc_hub_perda_motivo(date, date), public.rpc_hub_refugo_maquina(date, date),
                       public.rpc_hub_ops_refugo(date, date), public.rpc_hub_classificacao(date, date)
  from public, anon;
grant execute on function public.rpc_hub_maquinas(date, date), public.rpc_hub_paradas(date, date),
                          public.rpc_hub_perda_motivo(date, date), public.rpc_hub_refugo_maquina(date, date),
                          public.rpc_hub_ops_refugo(date, date), public.rpc_hub_classificacao(date, date)
  to authenticated;

-- Série mensal de apara (gráfico Aparas GPK e cartão de apara).
create or replace view public.v_hub_apara_mensal with (security_invoker = true) as
  select mes, refugo, peso_bruto_rebs, scrap_total,
         100 * refugo / nullif(refugo + peso_bruto_rebs, 0)           as apontado_pct,
         100 * scrap_total / nullif(peso_bruto_rebs + scrap_total, 0) as confirmado_pct
  from trusted.apara_mes
  order by mes;
grant select on public.v_hub_apara_mensal to authenticated;

-- Conferência: tem de devolver funcoes_ok = true.
select count(*) = 6 as funcoes_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rpc_hub_maquinas', 'rpc_hub_paradas', 'rpc_hub_perda_motivo',
                    'rpc_hub_refugo_maquina', 'rpc_hub_ops_refugo', 'rpc_hub_classificacao');
