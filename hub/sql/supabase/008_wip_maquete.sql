-- ============================================================================
-- 008_wip_maquete.sql — maquete 3D do WIP (14/10/2026). Rodar no SQL Editor do
-- Supabase DEPOIS do 001 a 007. Pode rodar de novo sem problema.
--
--   wip_pallet   cada pallet em processo (a mesma regra do trusted.wip: pallet
--                sem metro nem kg não conta), para achar etiqueta e OP na planta
--   planta       a planta baixa do chão de fábrica (só as linhas, em PNG). Fica
--                aqui, atrás do login, e não no site: o repositório é público
--   planta_area  posição de cada área na planta, ajustada no painel por um
--                administrador ("Ajustar planta"); sem linha, vale a do código
-- E troca o hub_publicar pela versão 6 (pallets e planta em chamadas próprias).
-- Leitura só pra quem está logado (RLS); gravar posição, só administrador.
-- ============================================================================

create table if not exists trusted.wip_pallet (
  etiqueta     text primary key,          -- número do pallet (etiqueta)
  op           text,
  etapa        text,                      -- atividade da OP (próxima etapa)
  local        text,                      -- LocalEstoque do banco
  cliente      text,
  situacao     text,                      -- Disponivel, Em uso, Em maquina
  situacao_op  text,
  metros       numeric,
  kg           numeric,
  inicio       timestamp                  -- início da OP, hora da fábrica
);

create table if not exists trusted.planta (
  id             smallint primary key default 1 check (id = 1),
  imagem         text not null,           -- PNG em base64
  largura_px     integer,
  altura_px      integer,
  metros_por_px  numeric not null,        -- da planta original
  recorte_px     jsonb not null,          -- [x0, y0, x1, y1] na planta original
  contorno_px    jsonb not null,          -- [[x, y], ...] do chão de fábrica
  assinatura     text,                    -- md5 da imagem
  atualizada_em  timestamptz not null default now()
);

create table if not exists trusted.planta_area (
  id            text primary key,         -- área da maquete (REB10, L04...)
  maquina       jsonb,                    -- {x, z, w, d} em metros, ou null (área sem máquina)
  estoque       jsonb not null,           -- {x, z, w, d} em metros
  ajustada_por  uuid,
  ajustada_em   timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['wip_pallet', 'planta', 'planta_area'] loop
    execute format('alter table trusted.%I enable row level security', t);
    execute format('drop policy if exists leitura on trusted.%I', t);
    execute format('create policy leitura on trusted.%I for select to authenticated using (true)', t);
    execute format('grant select on trusted.%I to authenticated', t);
  end loop;
end $$;

-- Publicação (versão 6): a versão 5 e mais os pallets e a planta.
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

  -- 008: os pallets do WIP e a planta vão cada um na sua chamada (são grandes)
  if dados ? 'wip_pallets' then
    delete from trusted.wip_pallet where true;
    insert into trusted.wip_pallet select * from jsonb_populate_recordset(null::trusted.wip_pallet, dados->'wip_pallets');
    get diagnostics n = row_count;
    return jsonb_build_object('wip_pallets', n, 'versao', 6);
  end if;
  if dados ? 'planta' then
    insert into trusted.planta (id, imagem, largura_px, altura_px, metros_por_px, recorte_px, contorno_px, assinatura, atualizada_em)
    select 1, p->>'imagem', (p->>'largura_px')::integer, (p->>'altura_px')::integer, (p->>'metros_por_px')::numeric,
           p->'recorte_px', p->'contorno_px', p->>'assinatura', now()
    from (select dados->'planta' as p) x
    on conflict (id) do update set imagem = excluded.imagem, largura_px = excluded.largura_px, altura_px = excluded.altura_px,
      metros_por_px = excluded.metros_por_px, recorte_px = excluded.recorte_px, contorno_px = excluded.contorno_px,
      assinatura = excluded.assinatura, atualizada_em = now();
    return jsonb_build_object('planta', 1, 'versao', 6);
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

  return jsonb_build_object('validacao', n_validacao, 'versao', 6);
end;
$$;

revoke all on function public.hub_publicar(jsonb) from public, anon;
grant execute on function public.hub_publicar(jsonb) to authenticated;

-- Posição {x, z, w, d} em metros: números, tamanho positivo, dentro da planta.
create or replace function trusted.posicao_valida(r jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(r) = 'object'
     and jsonb_typeof(r->'x') = 'number' and jsonb_typeof(r->'z') = 'number'
     and jsonb_typeof(r->'w') = 'number' and jsonb_typeof(r->'d') = 'number'
     and abs((r->>'x')::numeric) < 1000 and abs((r->>'z')::numeric) < 1000
     and (r->>'w')::numeric between 0.5 and 300 and (r->>'d')::numeric between 0.5 and 300;
$$;

-- "Ajustar planta" no painel: só administrador grava ou desfaz a posição de uma área.
create or replace function public.wip_area_salvar(p_id text, p_maquina jsonb, p_estoque jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'só administradores ajustam a planta' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_]{1,40}$' then
    raise exception 'área inválida';
  end if;
  if not trusted.posicao_valida(p_estoque)
     or (p_maquina is not null and jsonb_typeof(p_maquina) <> 'null' and not trusted.posicao_valida(p_maquina)) then
    raise exception 'posição fora do formato';
  end if;
  insert into trusted.planta_area (id, maquina, estoque, ajustada_por, ajustada_em)
  values (p_id, nullif(p_maquina, 'null'::jsonb), p_estoque, auth.uid(), now())
  on conflict (id) do update set maquina = excluded.maquina, estoque = excluded.estoque,
                                 ajustada_por = excluded.ajustada_por, ajustada_em = now();
end;
$$;
create or replace function public.wip_area_restaurar(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'só administradores ajustam a planta' using errcode = '42501';
  end if;
  delete from trusted.planta_area where id = p_id;
end;
$$;
revoke all on function public.wip_area_salvar(text, jsonb, jsonb), public.wip_area_restaurar(text) from public, anon;
grant execute on function public.wip_area_salvar(text, jsonb, jsonb), public.wip_area_restaurar(text) to authenticated;

-- Leitura pelo painel (aba WIP)
create or replace view public.v_hub_wip_pallet with (security_invoker = true) as
  select * from trusted.wip_pallet;
create or replace view public.v_hub_planta with (security_invoker = true) as
  select * from trusted.planta;
create or replace view public.v_hub_planta_area with (security_invoker = true) as
  select id, maquina, estoque, ajustada_em from trusted.planta_area;
revoke all on public.v_hub_wip_pallet, public.v_hub_planta, public.v_hub_planta_area from public, anon;
grant select on public.v_hub_wip_pallet, public.v_hub_planta, public.v_hub_planta_area to authenticated;

-- Conferência: tem de devolver maquete_ok = true.
select count(*) = 3 as maquete_ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('hub_publicar', 'wip_area_salvar', 'wip_area_restaurar')
  and (p.proname <> 'hub_publicar' or pg_get_functiondef(p.oid) like '%wip_pallet%');
