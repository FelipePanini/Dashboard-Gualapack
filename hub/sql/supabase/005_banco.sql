-- ============================================================================
-- 005_banco.sql — o que o painel ganhou com a leitura direta do banco da
-- fábrica (05/10/2026). Rodar no SQL Editor do Supabase DEPOIS do 001, 002 e
-- 003 (o 004 está incluído aqui). Pode rodar de novo sem problema.
--
-- Fotos do estado atual (o hub troca inteiras a cada publicação):
--   maquina_agora  o que cada máquina está fazendo agora e a OP aberta nela
--   programacao    fila de programação por máquina (OPs alocadas, não finalizadas)
--   wip            pallets em processo por etapa, local, cliente e idade
--   carteira       itens de pedido em aberto; carteira_mes: kg por mês de entrega
-- Séries por dia (um mês por publicação, como as do 002):
--   entrega_dia      entregas no prazo (classificação do PCP)
--   setup_dia        setup programado x real
--   laudo_dia        laudos do CQ por status
--   faturamento_dia  produto acabado faturado (kg = m² × gramatura ÷ 1000)
-- Leitura só pra quem está logado (RLS), como as outras tabelas do hub. Nada
-- de operador, analista, vendedor, preço nem observação.
-- ============================================================================

create table if not exists trusted.maquina_agora (
  maquina               text primary key,
  classe                text,            -- PRODUZINDO, SETUP... (tabela-padrão)
  cod_apont             text,
  cod_desc              text,
  desde                 timestamp,       -- início da atividade atual (hora da fábrica)
  terminou_em           timestamp,       -- sem atividade aberta: fim do último evento
  num_ordem             text,
  produto               text,
  cliente               text,
  processo              text,
  op_inicio             timestamp,
  op_inicio_producao    timestamp,
  qtd_planejada         numeric,         -- contador da máquina, na unidade da OP
  qtd_boa               numeric,
  vel_real_m_min        numeric,
  vel_programada_m_min  numeric,
  termino_programado    timestamp,
  dia                   date,            -- dia de produção mais recente
  horas_prod_dia        numeric,
  horas_tot_dia         numeric,         -- sem FIM TURNO e INATIVIDADE (regra do TMR)
  dados_ate             timestamp        -- apontamento mais novo que o hub leu
);

create table if not exists trusted.programacao (
  maquina        text not null,
  posicao        integer not null,
  num_ordem      text,
  cliente        text,
  produto        text,
  atividade      text,
  situacao       text,                   -- Liberada, Pendência de matéria-prima...
  ini_plan       timestamp,
  fim_plan       timestamp,
  entrega        date,
  qtd_planejada  numeric,
  qtd_produzida  numeric,
  saldo          numeric,
  primary key (maquina, posicao)
);

create table if not exists trusted.wip (
  etapa           text,
  local           text,
  cliente         text,
  situacao        text,
  idade           text,                  -- 0–7 dias, 8–30 dias, 31–90 dias, mais de 90 dias
  pallets         integer,
  ops             integer,
  metros          numeric,
  kg              numeric,
  op_mais_antiga  timestamp
);

create table if not exists trusted.carteira (
  num_pedido         text,
  cliente            text,
  item               text,
  produto            text,
  unidade            text,
  situacao           text,               -- Liberado, Não_Liberado, Revisado
  tipo_produto       text,
  quantidade         numeric,
  faturada           numeric,
  saldo              numeric,
  kg_total           numeric,
  kg_saldo           numeric,
  dt_pedido          date,
  entrega_cliente    date,
  entrega_pcp        date,
  entrega_negociada  date
);

create table if not exists trusted.carteira_mes (
  mes      date primary key,             -- mês da entrega que o cliente pediu
  itens    integer,
  pedidos  integer,
  kg       numeric
);

create table if not exists trusted.entrega_dia (
  dia      date not null,                -- dia do faturamento
  status   text not null,                -- 1 - ÓTIMO ... 5 - PÉSSIMO
  cliente  text not null,
  itens    integer not null default 0,
  notas    integer,
  primary key (dia, status, cliente)
);

create table if not exists trusted.setup_dia (
  dia                  date not null,    -- dia em que a OP saiu da máquina
  maquina              text not null,
  atividades           integer,
  min_programado       numeric,
  min_real             numeric,
  acima_do_programado  integer,
  primary key (dia, maquina)
);

create table if not exists trusted.laudo_dia (
  dia       date not null,
  status    text not null,               -- Aprovado, Reprovado, ... com Reanálise, Novo
  laudos    integer,
  analises  numeric,
  primary key (dia, status)
);

create table if not exists trusted.faturamento_dia (
  dia      date not null,
  cliente  text not null,
  notas    integer,
  itens    integer,
  m2       numeric,
  kg       numeric,
  primary key (dia, cliente)
);

do $$ declare t text; begin
  foreach t in array array['maquina_agora', 'programacao', 'wip', 'carteira', 'carteira_mes',
                           'entrega_dia', 'setup_dia', 'laudo_dia', 'faturamento_dia'] loop
    execute format('alter table trusted.%I enable row level security', t);
    execute format('drop policy if exists leitura on trusted.%I', t);
    execute format('create policy leitura on trusted.%I for select to authenticated using (true)', t);
    execute format('grant select on trusted.%I to authenticated', t);
  end loop;
end $$;

-- Publicação (versão 3): tudo do 001/002 e mais as fotos e séries acima.
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
      else
        raise exception 'conjunto desconhecido: %', dados->>'conjunto';
    end case;
    get diagnostics n = row_count;
    return jsonb_build_object('conjunto', dados->>'conjunto', 'linhas', n);
  end if;

  return jsonb_build_object('validacao', n_validacao, 'versao', 3);
end;
$$;
revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Leitura pelo painel
-- ---------------------------------------------------------------------------
-- Classe oficial de cada código (era o 004): cor das paradas.
create or replace view public.v_hub_codigos with (security_invoker = true) as
  select cod, descricao, classe from trusted.codigo_apontamento;
-- Fotos: o painel lê inteiras (são pequenas).
create or replace view public.v_hub_agora with (security_invoker = true) as
  select * from trusted.maquina_agora;
create or replace view public.v_hub_programacao with (security_invoker = true) as
  select * from trusted.programacao order by maquina, posicao;
create or replace view public.v_hub_wip with (security_invoker = true) as
  select * from trusted.wip;
create or replace view public.v_hub_carteira with (security_invoker = true) as
  select * from trusted.carteira;
revoke all on public.v_hub_codigos, public.v_hub_agora, public.v_hub_programacao, public.v_hub_wip,
              public.v_hub_carteira from public, anon;
grant select on public.v_hub_codigos, public.v_hub_agora, public.v_hub_programacao, public.v_hub_wip,
                public.v_hub_carteira to authenticated;

-- Entregas no período, por status da classificação do PCP.
create or replace function public.rpc_hub_entregas(p_de date default null, p_ate date default null)
returns table(status text, itens numeric, notas numeric)
language sql stable security invoker set search_path = '' as $$
  select status, sum(itens), sum(notas) from trusted.entrega_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1 order by 1;
$$;

-- Setup programado x real por máquina no período.
create or replace function public.rpc_hub_setup(p_de date default null, p_ate date default null)
returns table(maquina text, atividades numeric, min_programado numeric, min_real numeric, acima_do_programado numeric)
language sql stable security invoker set search_path = '' as $$
  select maquina, sum(atividades), sum(min_programado), sum(min_real), sum(acima_do_programado)
  from trusted.setup_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1 order by 1;
$$;

-- Laudos do CQ no período, por status.
create or replace function public.rpc_hub_laudos(p_de date default null, p_ate date default null)
returns table(status text, laudos numeric, analises numeric)
language sql stable security invoker set search_path = '' as $$
  select status, sum(laudos), sum(analises) from trusted.laudo_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1 order by 2 desc;
$$;

-- Série mensal dos últimos meses: entregas por status, laudos por status,
-- carteira (kg com entrega pedida no mês), produzido (peso bruto das REBs,
-- a base da apara) e faturado (kg) — gráficos de tendência.
create or replace function public.rpc_hub_mensal_banco(p_meses integer default 12)
returns table(mes date, entregas_otimo numeric, entregas_bom numeric, entregas_regular numeric,
              entregas_ruim numeric, entregas_pessimo numeric, laudos_aprovados numeric, laudos_reprovados numeric,
              laudos_total numeric, carteira_kg numeric, produzido_kg numeric, faturado_kg numeric,
              setup_min_programado numeric, setup_min_real numeric)
language sql stable security invoker set search_path = '' as $$
  with meses as (
    select generate_series(date_trunc('month', current_date) - make_interval(months => greatest(p_meses, 1) - 1),
                           date_trunc('month', current_date), interval '1 month')::date as mes
  ), e as (
    select date_trunc('month', dia)::date as mes,
           sum(itens) filter (where status like '1%') as otimo, sum(itens) filter (where status like '2%') as bom,
           sum(itens) filter (where status like '3%') as regular, sum(itens) filter (where status like '4%') as ruim,
           sum(itens) filter (where status like '5%') as pessimo
    from trusted.entrega_dia group by 1
  ), l as (
    select date_trunc('month', dia)::date as mes,
           sum(laudos) filter (where status like 'Aprovado%') as aprovados,
           sum(laudos) filter (where status like 'Reprovado%') as reprovados, sum(laudos) as total
    from trusted.laudo_dia group by 1
  ), f as (
    select date_trunc('month', dia)::date as mes, sum(kg) as kg from trusted.faturamento_dia group by 1
  ), s as (
    select date_trunc('month', dia)::date as mes, sum(min_programado) as prog, sum(min_real) as real
    from trusted.setup_dia group by 1
  )
  select m.mes, e.otimo, e.bom, e.regular, e.ruim, e.pessimo, l.aprovados, l.reprovados, l.total,
         c.kg, a.peso_bruto_rebs, f.kg, s.prog, s.real
  from meses m
  left join e using (mes) left join l using (mes) left join f using (mes) left join s using (mes)
  left join trusted.carteira_mes c using (mes)
  left join trusted.apara_mes a using (mes)
  order by m.mes;
$$;

revoke all on function public.rpc_hub_entregas(date, date), public.rpc_hub_setup(date, date),
                       public.rpc_hub_laudos(date, date), public.rpc_hub_mensal_banco(integer)
  from public, anon;
grant execute on function public.rpc_hub_entregas(date, date), public.rpc_hub_setup(date, date),
                          public.rpc_hub_laudos(date, date), public.rpc_hub_mensal_banco(integer)
  to authenticated;

-- Conferência: tem de devolver funcoes_ok = true.
select count(*) = 5 as funcoes_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('hub_publicar', 'rpc_hub_entregas', 'rpc_hub_setup', 'rpc_hub_laudos', 'rpc_hub_mensal_banco');
