-- ============================================================================
-- 007_oee.sql — OEE por máquina nos cartões do painel (08/10/2026). Rodar no
-- SQL Editor do Supabase DEPOIS do 001 a 006. Pode rodar de novo sem problema.
--
-- OEE = qualidade (aparas) × performance (velocidade) × disponibilidade
-- (paradas), decisão do dono. Performance e disponibilidade o painel já tem
-- (velocidade ÷ melhor mês da máquina; TMR). Este SQL traz a qualidade:
--   qualidade_maquina_dia  refugo apontado na máquina e peso final das OPs que
--                          passaram por ela (cada par máquina × OP no último
--                          dia em que a máquina produziu a OP)
-- E troca o hub_publicar pela versão 5: os conjuntos por dia passam a ser uma
-- lista (série nova = uma linha na lista, não a função inteira de novo).
-- Leitura só pra quem está logado (RLS), como as outras tabelas do hub.
-- ============================================================================

create table if not exists trusted.qualidade_maquina_dia (
  dia          date not null,
  maquina      text not null,
  refugo_kg    numeric,                     -- refugo apontado na máquina nessas OPs
  peso_ops_kg  numeric,                     -- peso bruto final dessas OPs (nas REBs)
  ops          integer,
  primary key (dia, maquina)
);
alter table trusted.qualidade_maquina_dia enable row level security;
drop policy if exists leitura on trusted.qualidade_maquina_dia;
create policy leitura on trusted.qualidade_maquina_dia for select to authenticated using (true);
grant select on trusted.qualidade_maquina_dia to authenticated;

-- Publicação (versão 5): o mesmo pacote da versão 4; os conjuntos por dia são
-- uma lista. Só o evento_dia tem regra própria (guarda só as últimas semanas).
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
    'qualidade_maquina_dia'                                                                              -- 007
  ];
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

  return jsonb_build_object('validacao', n_validacao, 'versao', 5);
end;
$$;
revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- Qualidade (aparas) de cada máquina no período: refugo ÷ (refugo + peso final
-- das OPs). qualidade_pct = 100 − apara_pct. p_ate é EXCLUSIVO, como nas outras.
create or replace function public.rpc_hub_qualidade_maquina(p_de date default null, p_ate date default null)
returns table(maquina text, refugo_kg numeric, peso_ops_kg numeric, ops bigint, apara_pct numeric, qualidade_pct numeric)
language sql stable security invoker set search_path = '' as $$
  select maquina, sum(refugo_kg), sum(peso_ops_kg), sum(ops),
         100 * sum(refugo_kg) / nullif(sum(refugo_kg) + sum(peso_ops_kg), 0),
         100 - 100 * sum(refugo_kg) / nullif(sum(refugo_kg) + sum(peso_ops_kg), 0)
  from trusted.qualidade_maquina_dia
  where (p_de is null or dia >= p_de) and (p_ate is null or dia < p_ate)
  group by 1 order by 1;
$$;
revoke all on function public.rpc_hub_qualidade_maquina(date, date) from public, anon;
grant execute on function public.rpc_hub_qualidade_maquina(date, date) to authenticated;

-- Conferência: tem de devolver funcoes_ok = true.
select count(*) = 2 as funcoes_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('hub_publicar', 'rpc_hub_qualidade_maquina')
  and (p.proname <> 'hub_publicar' or pg_get_functiondef(p.oid) like '%qualidade_maquina_dia%');
