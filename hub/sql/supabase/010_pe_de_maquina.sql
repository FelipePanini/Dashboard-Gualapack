-- ============================================================================
-- 010_pe_de_maquina.sql — pé de máquina (15/10/2026). Rodar no SQL Editor do
-- Supabase DEPOIS do 001 a 009. Pode rodar de novo sem problema.
--
--   mp_maquina  a matéria-prima no pé de cada máquina pelo sistema de bandeiras:
--               cada volume (bobina) com a bandeira, o item e a quantidade.
--               1 Aguardando · 2 Aceito · 3 Aguardando remoção · 4 Em uso ·
--               5 Aguardando finalização. O hub publica a foto a cada rodada.
-- E troca o hub_publicar pela versão 8 (a foto mp_maquina no pacote).
-- Leitura só pra quem está logado (RLS).
-- ============================================================================

create table if not exists trusted.mp_maquina (
  maquina       text,            -- como no painel (L04, RT01, REB 10...)
  local         text,            -- local de estoque no banco (MATRIZ - L04...)
  cod_item      text,
  descricao     text,
  bandeira      smallint,        -- 1 a 5, ver acima
  id_volume     text,
  quantidade    numeric,         -- kg disponíveis no volume
  data_entrada  timestamp        -- entrada do volume no estoque (hora da fábrica)
);
alter table trusted.mp_maquina enable row level security;
drop policy if exists leitura on trusted.mp_maquina;
create policy leitura on trusted.mp_maquina for select to authenticated using (true);
grant select on trusted.mp_maquina to authenticated;

-- Publicação (versão 8): a versão 7 e mais a foto da MP no pé das máquinas.
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
    return jsonb_build_object('wip_pallets', n, 'versao', 8);
  end if;
  if dados ? 'planta' then
    insert into trusted.planta (id, imagem, largura_px, altura_px, metros_por_px, recorte_px, contorno_px, assinatura, atualizada_em)
    select 1, p->>'imagem', (p->>'largura_px')::integer, (p->>'altura_px')::integer, (p->>'metros_por_px')::numeric,
           p->'recorte_px', p->'contorno_px', p->>'assinatura', now()
    from (select dados->'planta' as p) x
    on conflict (id) do update set imagem = excluded.imagem, largura_px = excluded.largura_px, altura_px = excluded.altura_px,
      metros_por_px = excluded.metros_por_px, recorte_px = excluded.recorte_px, contorno_px = excluded.contorno_px,
      assinatura = excluded.assinatura, atualizada_em = now();
    return jsonb_build_object('planta', 1, 'versao', 8);
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
  -- 010: a MP no pé das máquinas (foto do estado atual)
  if dados ? 'mp_maquina' then
    delete from trusted.mp_maquina where true;
    insert into trusted.mp_maquina select * from jsonb_populate_recordset(null::trusted.mp_maquina, dados->'mp_maquina');
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

  return jsonb_build_object('validacao', n_validacao, 'versao', 8);
end;
$$;

revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- Leitura pelo painel (aba Pé de máquina)
create or replace view public.v_hub_mp_maquina with (security_invoker = true) as
  select * from trusted.mp_maquina;
revoke all on public.v_hub_mp_maquina from public, anon;
grant select on public.v_hub_mp_maquina to authenticated;

-- Conferência: tem de devolver pe_de_maquina_ok = true.
select count(*) = 1 as pe_de_maquina_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'hub_publicar'
  and pg_get_functiondef(p.oid) like '%mp_maquina%';
