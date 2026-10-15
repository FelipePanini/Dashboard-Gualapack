-- ============================================================================
-- 009_gestao.sql — gestão por máquina (15/10/2026). Rodar no SQL Editor do
-- Supabase DEPOIS do 001 a 008. Pode rodar de novo sem problema.
--
--   meta_maquina       metas de cada máquina (velocidade, TMR, qualidade, OEE),
--                      gravadas no painel por um administrador; a linha FABRICA
--                      é a meta da fábrica. Sem linha, a máquina fica sem meta
--   meta_maquina_hist  cada alteração de meta: quem, quando e os valores
--   op_plano_dia       programado x produzido por OP e máquina (o hub publica):
--                      o que se produziu a mais que o programado
--   rpc_hub_maquina_serie    por máquina e dia (ou mês): horas, metros, qualidade,
--                            plano, perda — o D-1, a evolução e o pé de máquina
--   rpc_hub_paradas_maquina  paradas por máquina e código (gráficos que se filtram)
--   rpc_hub_op_excedente     OPs que terminaram no período, com o programado
-- E troca o hub_publicar pela versão 7 (o conjunto op_plano_dia).
-- Leitura só pra quem está logado (RLS); gravar meta, só administrador.
-- ============================================================================

create table if not exists trusted.meta_maquina (
  maquina           text primary key,      -- como na lista de máquinas (REB 10, L04...) ou FABRICA
  velocidade_m_min  numeric,
  tmr_pct           numeric,
  qualidade_pct     numeric,
  oee_pct           numeric,
  atualizada_por    uuid,
  atualizada_em     timestamptz not null default now()
);

create table if not exists trusted.meta_maquina_hist (
  id                bigserial primary key,
  maquina           text not null,
  velocidade_m_min  numeric,
  tmr_pct           numeric,
  qualidade_pct     numeric,
  oee_pct           numeric,
  alterada_por      uuid,
  alterada_em       timestamptz not null default now()
);

create table if not exists trusted.op_plano_dia (
  dia         date not null,               -- último dia em que a máquina produziu a OP
  maquina     text not null,
  num_ordem   text not null,
  produto     text,
  planejado   numeric,                     -- metros: a última programação da OP na máquina
  produzido   numeric,                     -- metros: a maior passada (a L04 passa a OP 2 a 3 vezes)
  passadas    integer,
  primary key (dia, maquina, num_ordem)
);

do $$ declare t text; begin
  foreach t in array array['meta_maquina', 'meta_maquina_hist', 'op_plano_dia'] loop
    execute format('alter table trusted.%I enable row level security', t);
    execute format('drop policy if exists leitura on trusted.%I', t);
    execute format('create policy leitura on trusted.%I for select to authenticated using (true)', t);
    execute format('grant select on trusted.%I to authenticated', t);
  end loop;
end $$;

-- Publicação (versão 7): a versão 6 e mais o programado x produzido por OP.
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
  conj text;
  -- conjuntos por dia aceitos (tabela trusted.<nome>, com a coluna dia)
  diarios constant text[] := array[
    'horas_maquina_dia', 'apara_dia', 'perda_dia', 'aderencia_dia', 'kg_maquina_dia', 'm2_maquina_dia',  -- 001 a 003
    'entrega_dia', 'setup_dia', 'laudo_dia', 'faturamento_dia',                                          -- 005
    'plano_dia', 'evento_dia',                                                                           -- 006
    'qualidade_maquina_dia',                                                                             -- 007
    'op_plano_dia'                                                                                       -- 009
  ];
begin
  if not exists (select 1 from trusted.escritores where user_id = auth.uid()) then
    raise exception 'sem permissão para publicar dados do hub' using errcode = '42501';
  end if;

  -- 008: os pallets do WIP e a planta vão cada um na sua chamada (são grandes)
  if dados ? 'wip_pallets' then
    delete from trusted.wip_pallet where true;
    insert into trusted.wip_pallet select * from jsonb_populate_recordset(null::trusted.wip_pallet, dados->'wip_pallets');
    get diagnostics n = row_count;
    return jsonb_build_object('wip_pallets', n, 'versao', 7);
  end if;
  if dados ? 'planta' then
    insert into trusted.planta (id, imagem, largura_px, altura_px, metros_por_px, recorte_px, contorno_px, assinatura, atualizada_em)
    select 1, p->>'imagem', (p->>'largura_px')::integer, (p->>'altura_px')::integer, (p->>'metros_por_px')::numeric,
           p->'recorte_px', p->'contorno_px', p->>'assinatura', now()
    from (select dados->'planta' as p) x
    on conflict (id) do update set imagem = excluded.imagem, largura_px = excluded.largura_px, altura_px = excluded.altura_px,
      metros_por_px = excluded.metros_por_px, recorte_px = excluded.recorte_px, contorno_px = excluded.contorno_px,
      assinatura = excluded.assinatura, atualizada_em = now();
    return jsonb_build_object('planta', 1, 'versao', 7);
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
    conj := dados->>'conjunto';
    de := (dados->>'de')::date;
    ate := (dados->>'ate')::date;
    if de is null or ate is null then
      raise exception 'conjunto % sem intervalo (de/ate)', conj;
    end if;
    if not (conj = any(diarios)) then
      raise exception 'conjunto desconhecido: %', conj;
    end if;
    if conj = 'evento_dia' then
      -- guarda só as últimas semanas: a linha do tempo mostra os últimos 14 dias
      delete from trusted.evento_dia where dia between de and ate or dia < current_date - 40;
    else
      execute format('delete from trusted.%I where dia between $1 and $2', conj) using de, ate;
    end if;
    execute format('insert into trusted.%I select * from jsonb_populate_recordset(null::trusted.%I, $1)', conj, conj)
      using dados->'linhas';
    get diagnostics n = row_count;
    return jsonb_build_object('conjunto', conj, 'linhas', n);
  end if;

  return jsonb_build_object('validacao', n_validacao, 'versao', 7);
end;
$$;

revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- Metas no painel: só administrador grava. Valor vazio (null) apaga aquela meta.
create or replace function public.meta_maquina_salvar(p_maquina text, p_velocidade numeric, p_tmr numeric,
                                                      p_qualidade numeric, p_oee numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'só administradores alteram metas' using errcode = '42501';
  end if;
  if p_maquina is null or p_maquina !~ '^[A-Za-z0-9 ._-]{1,40}$' then
    raise exception 'máquina inválida';
  end if;
  if (p_velocidade is not null and (p_velocidade <= 0 or p_velocidade > 2000))
     or (p_tmr is not null and (p_tmr <= 0 or p_tmr > 100))
     or (p_qualidade is not null and (p_qualidade <= 0 or p_qualidade > 100))
     or (p_oee is not null and (p_oee <= 0 or p_oee > 100)) then
    raise exception 'meta fora da faixa (velocidade até 2000 m/min, percentuais de 0 a 100)';
  end if;
  insert into trusted.meta_maquina (maquina, velocidade_m_min, tmr_pct, qualidade_pct, oee_pct, atualizada_por, atualizada_em)
  values (upper(trim(p_maquina)), p_velocidade, p_tmr, p_qualidade, p_oee, auth.uid(), now())
  on conflict (maquina) do update set velocidade_m_min = excluded.velocidade_m_min, tmr_pct = excluded.tmr_pct,
    qualidade_pct = excluded.qualidade_pct, oee_pct = excluded.oee_pct,
    atualizada_por = excluded.atualizada_por, atualizada_em = now();
  insert into trusted.meta_maquina_hist (maquina, velocidade_m_min, tmr_pct, qualidade_pct, oee_pct, alterada_por)
  values (upper(trim(p_maquina)), p_velocidade, p_tmr, p_qualidade, p_oee, auth.uid());
end;
$$;
revoke all on function public.meta_maquina_salvar(text, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.meta_maquina_salvar(text, numeric, numeric, numeric, numeric) to authenticated;

-- Por máquina e dia (p_grao 'dia') ou mês ('mes'), no período [p_de, p_ate):
--   TMR = horas_produzindo ÷ horas_totais (sem FIM TURNO e INATIVIDADE, como o BI)
--   velocidade = metros ÷ (60 × horas_produzindo)
--   qualidade = 100 − refugo ÷ (refugo + peso das OPs), a do OEE (007)
--   planejado x realizado = o plano do BI (006), em metros
create or replace function public.rpc_hub_maquina_serie(p_de date, p_ate date, p_grao text default 'dia')
returns table(periodo date, maquina text, horas_totais numeric, horas_produzindo numeric, metros numeric,
              refugo_kg numeric, peso_ops_kg numeric, planejado numeric, realizado numeric, perda_kg numeric)
language sql stable security invoker set search_path = '' as $$
  with h as (
    select case when p_grao = 'mes' then date_trunc('month', dia)::date else dia end as periodo, maquina,
           sum(horas) filter (where classe not in ('FIM TURNO', 'INATIVIDADE')) as tot,
           sum(horas) filter (where classe = 'PRODUZINDO') as prod, sum(metros) as metros
    from trusted.horas_maquina_dia where dia >= p_de and dia < p_ate group by 1, 2
  ), q as (
    select case when p_grao = 'mes' then date_trunc('month', dia)::date else dia end as periodo, maquina,
           sum(refugo_kg) as refugo, sum(peso_ops_kg) as peso
    from trusted.qualidade_maquina_dia where dia >= p_de and dia < p_ate group by 1, 2
  ), pl as (
    select case when p_grao = 'mes' then date_trunc('month', dia)::date else dia end as periodo, maquina,
           sum(planejado) as plan, sum(realizado) as real
    from trusted.plano_dia where dia >= p_de and dia < p_ate group by 1, 2
  ), pe as (
    select case when p_grao = 'mes' then date_trunc('month', dia)::date else dia end as periodo, maquina, sum(kg) as kg
    from trusted.perda_dia where dia >= p_de and dia < p_ate group by 1, 2
  ), chaves as (
    select periodo, maquina from h union select periodo, maquina from q
    union select periodo, maquina from pl union select periodo, maquina from pe
  )
  select c.periodo, c.maquina, coalesce(h.tot, 0), coalesce(h.prod, 0), coalesce(h.metros, 0),
         q.refugo, q.peso, coalesce(pl.plan, 0), coalesce(pl.real, 0), coalesce(pe.kg, 0)
  from chaves c
  left join h using (periodo, maquina) left join q using (periodo, maquina)
  left join pl using (periodo, maquina) left join pe using (periodo, maquina)
  order by 1, 2;
$$;

-- Paradas por máquina e código no período (tudo que não é PRODUZINDO).
create or replace function public.rpc_hub_paradas_maquina(p_de date default null, p_ate date default null)
returns table(maquina text, cod_apont text, cod_desc text, classe text, horas numeric)
language sql stable security invoker set search_path = '' as $$
  select maquina, cod_apont, coalesce(max(cod_desc), cod_apont), max(classe), sum(horas)
  from trusted.horas_maquina_dia
  where classe <> 'PRODUZINDO'
    and (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by maquina, cod_apont
  having sum(horas) > 0
  order by 5 desc;
$$;

-- OPs que terminaram na máquina no período, com o programado e o produzido.
create or replace function public.rpc_hub_op_excedente(p_de date default null, p_ate date default null)
returns table(dia date, maquina text, num_ordem text, produto text, planejado numeric, produzido numeric, passadas integer)
language sql stable security invoker set search_path = '' as $$
  select dia, maquina, num_ordem, produto, planejado, produzido, passadas
  from trusted.op_plano_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  order by produzido - planejado desc;
$$;

revoke all on function public.rpc_hub_maquina_serie(date, date, text), public.rpc_hub_paradas_maquina(date, date),
                       public.rpc_hub_op_excedente(date, date) from public, anon;
grant execute on function public.rpc_hub_maquina_serie(date, date, text), public.rpc_hub_paradas_maquina(date, date),
                          public.rpc_hub_op_excedente(date, date) to authenticated;

-- Leitura pelo painel
create or replace view public.v_hub_meta_maquina with (security_invoker = true) as
  select maquina, velocidade_m_min, tmr_pct, qualidade_pct, oee_pct, atualizada_em from trusted.meta_maquina;
revoke all on public.v_hub_meta_maquina from public, anon;
grant select on public.v_hub_meta_maquina to authenticated;

-- Conferência: tem de devolver gestao_ok = true.
select count(*) = 5 as gestao_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('hub_publicar', 'meta_maquina_salvar', 'rpc_hub_maquina_serie', 'rpc_hub_paradas_maquina', 'rpc_hub_op_excedente')
  and (p.proname <> 'hub_publicar' or pg_get_functiondef(p.oid) like '%op_plano_dia%');
