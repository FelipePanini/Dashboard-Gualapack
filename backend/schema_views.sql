-- ============================================================================
-- Painel de Produção Gualapack — views agregadas pro dashboard
-- Alvo: Supabase (Postgres 15+). Rode depois de schema_data.sql, uma vez.
-- ----------------------------------------------------------------------------
-- As tabelas brutas (apontamentos, aderencia_maquinas_diaria,
-- aderencia_programacao...) têm centenas de milhares de linhas — o
-- navegador NUNCA deve fazer select nelas direto. Estas views fazem a soma/
-- agrupamento dentro do banco; demo/index.html só lê o resultado, que é
-- sempre pequeno (algumas dezenas de linhas, no máximo).
--
-- "security_invoker = true" faz a view respeitar o RLS das tabelas de
-- origem com base em quem está consultando (não em quem criou a view) —
-- sem isso, uma view roda com o privilégio de quem a criou, ignorando RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Resumo por máquina — TMR, horas, perda, aderência (planejado/realizado)
--    Só entram máquinas de produção de verdade (grupo físico) — o Machine
--    Card mistura máquinas reais com categorias administrativas (GERAL,
--    IMPRESSORAS, MANUTENÇÃO...) que não são recursos físicos.
--
--    "drop view" antes do "create": adicionamos horas_planejado/
--    horas_disponiveis em 2026-09-16 e o Postgres não deixa "create or
--    replace" mudar/inserir coluna no meio da lista de saída de uma view
--    existente (só no fim) — precisa recriar.
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- 1. Resumo por máquina — TMR, horas, perda, aderência (planejado/realizado)
--    Agora é rpc_maquinas_resumo(p_de, p_ate): função parametrizada por
--    período, criada pra o filtro de datas do painel poder pedir "só este
--    mês" / "só esta semana" em vez de sempre somar o histórico inteiro.
--    A view abaixo é um atalho — select * from rpc(null,null) — que mantém
--    o comportamento de antes (histórico completo) pra quem consulta a
--    view direto, sem precisar saber que agora é uma função por trás.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_maquinas_resumo(p_de date default null, p_ate date default null)
returns table(
  id text, grupo text,
  horas_totais numeric, horas_planejado numeric, horas_disponiveis numeric, horas_produzindo numeric,
  kg_perda_total numeric, peso_bruto_total numeric,
  qtd_planejada numeric, qtd_produzida numeric
)
language sql stable security invoker as $$
  select
    m.id, m.grupo,
    coalesce(ap.horas_totais,0),
    coalesce(ap.horas_planejado,0),
    -- TMR = horas_produzindo / horas_disponiveis (não / horas_totais).
    -- "PLANEJADO" (fim de turno, refeição, treinamento, manutenção
    -- preventiva) não é tempo que a máquina "deveria" estar rodando —
    -- incluir isso no denominador subestimava o TMR em ~10-15 p.p. contra
    -- o Power BI (validado em 2026-09-16: R12 saía 24%, o real é 62%).
    coalesce(ap.horas_totais,0) - coalesce(ap.horas_planejado,0),
    coalesce(ap.horas_produzindo,0),
    -- kg_perda_total/peso_bruto_total vêm de producao_kg, não de
    -- apontamentos: em apontamentos, peso_bruto_bobina só existe nas
    -- linhas do Indicadores Diário (5 máquinas), mas kg_perda também vem
    -- das Base Aparas (16 máquinas) — numerador de 16 dividido por
    -- denominador de 5 dava apara de até 60% (fisicamente impossível).
    -- producao_kg tem os dois na MESMA linha, mesma fonte, pras 16
    -- máquinas (validado em 2026-09-21: REB 05 6,1%, REB 10 11,1% — bate
    -- com a ordem de grandeza do scrap do Power BI).
    --
    -- Descoberto no mesmo dia, testando com período curto pela primeira
    -- vez: o preenchimento de peso_bruto em producao_kg vem caindo com o
    -- tempo (72-82% das linhas até início de 2026, 20-30% a partir de
    -- maio/2026). No agregado de 12 meses isso dilui; num período curto
    -- ("este mês") dá pra cair quase só nos dias mal preenchidos e
    -- kg_perda > peso_bruto, "apara" de mais de 100%. Perda não pode ser
    -- maior que o peso do qual ela saiu — quando a conta dá isso, trata
    -- como dado insuficiente (0/0, mesma convenção do resto da view) em
    -- vez de mostrar um número absurdo. Não conserta o preenchimento ruim
    -- da planilha; só impede a conta impossível de chegar na tela.
    case when coalesce(kg.refugo,0) > coalesce(kg.peso_bruto,0) then 0 else coalesce(kg.refugo,0) end,
    case when coalesce(kg.refugo,0) > coalesce(kg.peso_bruto,0) then 0 else coalesce(kg.peso_bruto,0) end,
    -- Nomes neutros de propósito: a fonte antiga (arquivo morto) tinha
    -- esses campos rotulados como "km" e chegou a mostrar 12,3 bilhões de
    -- "km" — número absurdo da fonte errada. A fonte nova (ADERÊNCIA
    -- DIÁRIA) não confirma a unidade ainda — não relabelar sem confirmar.
    coalesce(ad.qtd_planejada,0),
    coalesce(ad.qtd_produzida,0)
  from public.maquinas m
  left join (
    select a.cod_recurso,
      -- A classificação sai do CADASTRO de códigos
      -- (classificacao_apontamento), não mais só da coluna da planilha.
      -- Em 2026-09-18 a aba Base Apontamento perdeu a coluna CLASSIFICAÇÃO
      -- DISP. e horas_planejado virou 0 em toda máquina sem erro nenhum na
      -- carga. O coalesce mantém a coluna como primeira opção enquanto ela
      -- existir e cai no cadastro quando vier vazia.
      sum(a.qtd_horas)                                   as horas_totais,
      sum(a.qtd_horas) filter (
        where coalesce(a.classificacao_disp, c.classificacao_disp) = 'PRODUZINDO'
      )                                                  as horas_produzindo,
      sum(a.qtd_horas) filter (
        where coalesce(a.classificacao_disp, c.classificacao_disp) = 'PLANEJADO'
      )                                                  as horas_planejado
    from public.apontamentos a
    left join public.classificacao_apontamento c on c.cod = a.cod_apont
    where a.cod_recurso is not null
      and (p_de is null or a.dt_producao >= p_de)
      and (p_ate is null or a.dt_producao < p_ate)
    group by a.cod_recurso
  ) ap on ap.cod_recurso = m.id
  left join (
    select cod_recurso, sum(peso_bruto) as peso_bruto, sum(refugo) as refugo
    from public.producao_kg
    where cod_recurso is not null
      and (p_de is null or dt_producao >= p_de)
      and (p_ate is null or dt_producao < p_ate)
    group by cod_recurso
  ) kg on kg.cod_recurso = m.id
  left join (
    select maquina, sum(qtd_planejada) as qtd_planejada, sum(qtd_produzida) as qtd_produzida
    from public.aderencia_programacao
    where maquina is not null
      and (p_de is null or dt_ini_plan >= p_de)
      and (p_ate is null or dt_ini_plan < p_ate)
    group by maquina
  ) ad on ad.maquina = m.id
  where m.grupo in ('COATING','LAMINADORAS','FUNGICIDA','FLEXOGRAFIA','CORTADEIRAS','ROTOGRAVURA','HOT MELT');
$$;
grant execute on function public.rpc_maquinas_resumo(date,date) to authenticated;

create or replace view public.v_maquinas_resumo
with (security_invoker = true) as
select * from public.rpc_maquinas_resumo(null, null);

-- ----------------------------------------------------------------------------
-- 2. Perda por motivo (código real usr_tipodaperda -> kg)
-- ----------------------------------------------------------------------------
create or replace function public.rpc_perda_por_motivo(p_de date default null, p_ate date default null)
returns table(tipo_perda text, kg numeric)
language sql stable security invoker as $$
  select tipo_perda, sum(kg_perda) as kg
  from public.apontamentos
  where tipo_perda is not null and tipo_perda <> '' and kg_perda is not null
    and (p_de is null or dt_producao >= p_de)
    and (p_ate is null or dt_producao < p_ate)
  group by tipo_perda
  order by kg desc;
$$;
grant execute on function public.rpc_perda_por_motivo(date,date) to authenticated;

create or replace view public.v_perda_por_motivo
with (security_invoker = true) as
select * from public.rpc_perda_por_motivo(null, null);

-- ----------------------------------------------------------------------------
-- 3. Apara por classificação de produto
-- ----------------------------------------------------------------------------
create or replace function public.rpc_perda_por_classificacao(p_de date default null, p_ate date default null)
returns table(classificacao text, kg_perda numeric, peso_bruto numeric, apara_pct numeric)
language sql stable security invoker as $$
  -- Mesmo caveat de população da apara-por-máquina (ver rpc_maquinas_resumo)
  -- se aplica aqui, e não tem como trocar de fonte: producao_kg não tem
  -- coluna "classificação". Fora de escopo desta leva — filtra por data,
  -- mas não conserta o mismatch de população nem a queda de preenchimento.
  select
    classificacao,
    sum(kg_perda)           as kg_perda,
    sum(peso_bruto_bobina)  as peso_bruto,
    case when sum(peso_bruto_bobina) > 0
      then sum(kg_perda) / sum(peso_bruto_bobina) * 100
      else 0
    end as apara_pct
  from public.apontamentos
  where classificacao is not null and classificacao <> ''
    and (p_de is null or dt_producao >= p_de)
    and (p_ate is null or dt_producao < p_ate)
  group by classificacao;
$$;
grant execute on function public.rpc_perda_por_classificacao(date,date) to authenticated;

create or replace view public.v_perda_por_classificacao
with (security_invoker = true) as
select * from public.rpc_perda_por_classificacao(null, null);

-- ----------------------------------------------------------------------------
-- 4. Horas por tipo de apontamento (downtime), excluindo "Produzindo" (20)
-- ----------------------------------------------------------------------------
create or replace function public.rpc_downtime_por_status(p_de date default null, p_ate date default null)
returns table(cod_apont text, cod_desc text, horas numeric)
language sql stable security invoker as $$
  select cod_apont, cod_desc, sum(qtd_horas) as horas
  from public.apontamentos
  where cod_apont is distinct from '20' and cod_desc is not null and cod_desc <> ''
    and (p_de is null or dt_producao >= p_de)
    and (p_ate is null or dt_producao < p_ate)
  group by cod_apont, cod_desc
  order by horas desc;
$$;
grant execute on function public.rpc_downtime_por_status(date,date) to authenticated;

create or replace view public.v_downtime_por_status
with (security_invoker = true) as
select * from public.rpc_downtime_por_status(null, null);

-- ----------------------------------------------------------------------------
-- 5. Série mensal de aparas — apontado (fardos) e confirmado (balança)
-- ----------------------------------------------------------------------------
-- Dois filtros que existem pelo mesmo motivo: não deixar mês sem realizado
-- virar 0% na série.
--   "data <= current_date": as planilhas trazem os meses futuros do ano já
--   como linha, zerados. Sem o corte eles entravam como realizado e o KPI
--   da capa (que lê o último mês da série) mostrava 0,0%.
--   "having sum(...) > 0": o mês corrente também vem zerado até fechar, e
--   mês sem volume medido não tem percentual de apara — mostrar 0% ali
--   seria inventar número. Sem volume = o mês simplesmente não entra.
create or replace view public.v_fardos_mensal
with (security_invoker = true) as
select
  date_trunc('month', data)::date as mes,
  sum(qtd_bruta_kg)   as bruta_kg,
  sum(qtd_liquida_kg) as liquida_kg,
  (sum(qtd_bruta_kg) - sum(qtd_liquida_kg)) / sum(qtd_bruta_kg) * 100 as apara_pct
from public.fardos_aparas
where data is not null
  and data <= current_date
group by 1
having sum(qtd_bruta_kg) > 0
order by 1;

-- Mesmos dois filtros da view acima, pelo mesmo motivo: "Conta Refugo" vai
-- até dezembro do ano corrente com os meses que ainda não aconteceram
-- zerados, e o mês em curso também fica zerado até fechar.
create or replace view public.v_refugo_mensal
with (security_invoker = true) as
select
  date_trunc('month', data)::date as mes,
  sum(volume_jgr) as volume_jgr,
  sum(scrap_jgr)  as scrap_jgr,
  sum(scrap_jgr) / sum(volume_jgr) * 100 as scrap_pct
from public.refugo_aparas_historico
where data is not null
  and data <= current_date
group by 1
having sum(volume_jgr) > 0
order by 1;

-- ----------------------------------------------------------------------------
-- 6. Ordens com maior refugo (top 50)
-- ----------------------------------------------------------------------------
create or replace function public.rpc_ops_refugo(p_de date default null, p_ate date default null)
returns table(num_ordem text, cod_recurso text, descricao text, peso_bruto numeric, kg_perda numeric, apara_pct numeric, motivo_principal text)
language sql stable security invoker as $$
  select
    num_ordem,
    cod_recurso,
    max(des_num_ordem) as descricao,
    sum(peso_bruto_bobina) as peso_bruto,
    sum(kg_perda) as kg_perda,
    case when sum(peso_bruto_bobina) > 0
      then sum(kg_perda) / sum(peso_bruto_bobina) * 100
      else 0
    end as apara_pct,
    mode() within group (order by tipo_perda) as motivo_principal
  from public.apontamentos
  where num_ordem is not null and num_ordem <> '' and peso_bruto_bobina > 0
    and (p_de is null or dt_producao >= p_de)
    and (p_ate is null or dt_producao < p_ate)
  group by num_ordem, cod_recurso
  order by apara_pct desc
  limit 50;
$$;
grant execute on function public.rpc_ops_refugo(date,date) to authenticated;

create or replace view public.v_ops_refugo
with (security_invoker = true) as
select * from public.rpc_ops_refugo(null, null);

-- ----------------------------------------------------------------------------
-- 7. Linha do tempo — apontamentos do dia mais recente com dado (não é
--    "agora", é o último dia completo que a carga trouxe)
--
--    "having count(*) >= 20": os últimos 1-2 dias da planilha de origem
--    costumam vir parciais (a base ainda está sendo preenchida quando o
--    Excel é atualizado) — um dia normal tem 45-59 apontamentos, mas o
--    dia mais recente às vezes chega com só 2. Sem esse filtro, MAX(data)
--    pega esse dia quase vazio e a linha do tempo parece quebrada. Mesmo
--    problema, mesma solução das views mensais de apara/refugo acima.
-- ----------------------------------------------------------------------------
create or replace view public.v_apontamentos_ultimo_dia
with (security_invoker = true) as
with ultimo_dia as (
  select dt_producao as d
  from public.apontamentos
  where dt_producao is not null
    and hora_inicio is not null
    and hora_fim is not null
    and cod_recurso is not null
  group by dt_producao
  having count(*) >= 20
  order by dt_producao desc
  limit 1
)
select a.cod_recurso, a.cod_apont, a.cod_desc, a.hora_inicio, a.hora_fim, a.num_ordem
from public.apontamentos a, ultimo_dia
where a.dt_producao = ultimo_dia.d
  and a.hora_inicio is not null
  and a.hora_fim is not null
  and a.cod_recurso is not null
order by a.cod_recurso, a.hora_inicio;

-- ----------------------------------------------------------------------------
-- 8. Refugo por máquina (de "Refugo Produção.xlsx", aba "Consulta Perda")
--    — granularidade real por evento/máquina/motivo, complementa a visão de
--    perda por motivo (que vem de apontamentos).
-- ----------------------------------------------------------------------------
create or replace view public.v_refugo_producao_maquina
with (security_invoker = true) as
select
  maquina,
  sum(kg_perda) as kg_perda,
  mode() within group (order by tipo) as motivo_principal
from public.refugo_producao
where maquina is not null and maquina <> ''
group by maquina
order by kg_perda desc;

-- ----------------------------------------------------------------------------
-- 9. Produção/refugo em kg por mês (de "Indicadores Diário - AAAA.xlsx",
--    aba "Base Apontamentos (kg)")
-- ----------------------------------------------------------------------------
create or replace view public.v_producao_kg_mensal
with (security_invoker = true) as
select
  date_trunc('month', dt_producao)::date as mes,
  sum(peso_bruto) as peso_bruto_kg,
  sum(refugo) as refugo_kg,
  case when sum(peso_bruto) > 0
    then sum(refugo) / sum(peso_bruto) * 100
    else 0
  end as refugo_pct
from public.producao_kg
where dt_producao is not null
group by 1
order by 1;

-- ----------------------------------------------------------------------------
-- 10. Scrap % mensal direto do Power BI (de scrap_bi_mensal — ver nota em
--     schema_data.sql sobre não ser o mesmo número de fardos_aparas).
--     "where producao > 0" pelo mesmo motivo das outras séries mensais:
--     meses futuros/ainda não fechados vêm zerados na planilha.
-- ----------------------------------------------------------------------------
create or replace view public.v_scrap_bi_mensal
with (security_invoker = true) as
select
  data as mes,
  producao,
  refugo_total,
  case when producao > 0 then refugo_total / producao * 100 else null end as scrap_pct
from public.scrap_bi_mensal
where producao > 0
order by data;

-- ----------------------------------------------------------------------------
-- 11. Produtividade (m²/h) e velocidade (m/min), por máquina e por mês
--     (de producao_metros — Machine Card [PRODUCAO_METROS]).
--     qtd_horas aqui é só tempo de produção da OP (não inclui parada), então
--     a velocidade sai direto de metros ÷ minutos, sem descontar nada.
--
--     O join com maquinas + filtro de grupo é o MESMO de v_maquinas_resumo:
--     a Machine Card traz recursos administrativos/lógicos que não estão no
--     cadastro de máquinas (EMBALAGEM3, 01CORTESOLDA, REB 10L...) e distorcem
--     o ranking — REB 10L aparecia com 0 h e produção, ou seja, produtividade
--     "infinita". O having sum(qtd_horas) > 0 protege a divisão para sempre,
--     inclusive quando a carga diária trouxer uma máquina nova sem horas.
--
--     velocidade_ref_m_min = melhor MÊS da própria máquina dentro da janela
--     de retenção (producao_metros guarda 12 meses). Não é velocidade
--     nominal de engenharia nem número do Power BI: é capacidade já
--     demonstrada pela máquina, e se move sozinha conforme a base rola.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_produtividade_maquina(p_de date default null, p_ate date default null)
returns table(
  cod_recurso text, producao_m2 numeric, producao_m numeric, horas numeric,
  produtividade_m2h numeric, velocidade_m_min numeric, velocidade_ref_m_min numeric
)
language sql stable security invoker as $$
  with base_total as (
    select p.cod_recurso, p.dt_producao, p.producao_m2, p.qtd_produzida_m, p.qtd_horas
    from public.producao_metros p
    join public.maquinas m on m.id = p.cod_recurso
    where p.cod_recurso is not null and p.dt_producao is not null
      and m.grupo in ('COATING','LAMINADORAS','FUNGICIDA','FLEXOGRAFIA','CORTADEIRAS','ROTOGRAVURA','HOT MELT')
  ), total as (
    select cod_recurso, sum(qtd_horas) as horas_total from base_total group by 1
  ), mensal as (
    select cod_recurso, date_trunc('month', dt_producao) as mes,
           sum(qtd_produzida_m) as metros, sum(qtd_horas) as horas
    from base_total group by 1, 2
  ), ref as (
    -- Referência (melhor mês) sempre olha o HISTÓRICO INTEIRO, nunca o
    -- período filtrado — senão vira "melhor mês dentro dos 3 dias
    -- escolhidos", que deixa de ser referência de nada. Só entram meses
    -- com volume real (corte de 5% das horas da própria máquina, piso de
    -- 20h) pelo mesmo motivo de sempre: mês residual não vira referência.
    select mn.cod_recurso, max(mn.metros / (mn.horas * 60)) as velocidade_ref_m_min
    from mensal mn
    join total t on t.cod_recurso = mn.cod_recurso
    where mn.horas >= greatest(20, 0.05 * t.horas_total)
    group by 1
  ), periodo as (
    -- este sim respeita o período escolhido no painel.
    select cod_recurso, producao_m2, qtd_produzida_m, qtd_horas
    from base_total
    where (p_de is null or dt_producao >= p_de)
      and (p_ate is null or dt_producao < p_ate)
  )
  select
    b.cod_recurso,
    sum(b.producao_m2)                                                    as producao_m2,
    sum(b.qtd_produzida_m)                                                as producao_m,
    sum(b.qtd_horas)                                                      as horas,
    case when sum(b.qtd_horas) > 0 then sum(b.producao_m2) / sum(b.qtd_horas) end         as produtividade_m2h,
    case when sum(b.qtd_horas) > 0 then sum(b.qtd_produzida_m) / (sum(b.qtd_horas)*60) end as velocidade_m_min,
    coalesce(
      max(r.velocidade_ref_m_min),
      case when sum(b.qtd_horas) > 0 then sum(b.qtd_produzida_m) / (sum(b.qtd_horas)*60) end
    )                                                                     as velocidade_ref_m_min
  from periodo b
  left join ref r on r.cod_recurso = b.cod_recurso
  group by b.cod_recurso
  having sum(b.qtd_horas) > 0;
$$;
grant execute on function public.rpc_produtividade_maquina(date,date) to authenticated;

create or replace view public.v_produtividade_maquina
with (security_invoker = true) as
select * from public.rpc_produtividade_maquina(null, null);

create or replace view public.v_produtividade_mensal
with (security_invoker = true) as
select
  date_trunc('month', p.dt_producao)::date as mes,
  sum(p.producao_m2)     as producao_m2,
  sum(p.qtd_produzida_m) as producao_m,
  sum(p.qtd_horas)       as horas,
  case when sum(p.qtd_horas) > 0 then sum(p.producao_m2) / sum(p.qtd_horas) end       as produtividade_m2h,
  case when sum(p.qtd_horas) > 0 then sum(p.qtd_produzida_m) / (sum(p.qtd_horas)*60) end as velocidade_m_min
from public.producao_metros p
join public.maquinas m on m.id = p.cod_recurso
where p.dt_producao is not null
  and m.grupo in ('COATING','LAMINADORAS','FUNGICIDA','FLEXOGRAFIA','CORTADEIRAS','ROTOGRAVURA','HOT MELT')
group by 1
having sum(p.qtd_horas) > 0
order by 1;

-- ----------------------------------------------------------------------------
-- 12. Até quando cada base tem dado
--
--     O painel não tinha como saber que estava atrasado: a carga roda todo
--     dia e termina com "sucesso" mesmo relendo planilha velha. Em 18/09 as
--     bases estavam paradas em 31/08 e nada na tela dizia isso. Esta view é
--     o que o selo do topo e o indicador de status leem para mostrar a data
--     do dado, e ficar âmbar quando ele envelhece.
-- ----------------------------------------------------------------------------
create or replace view public.v_dados_status
with (security_invoker = true) as
select 'apontamentos'     as base, max(dt_producao) as ate from public.apontamentos
union all select 'producao_metros',        max(dt_producao) from public.producao_metros
union all select 'producao_kg',            max(dt_producao) from public.producao_kg
union all select 'refugo_producao',        max(dt_producao) from public.refugo_producao
union all select 'aderencia',              max(dt_ini_plan) from public.aderencia_programacao
union all select 'fardos_aparas',          max(data)        from public.fardos_aparas;

-- ----------------------------------------------------------------------------
-- Permissões — mesma regra das tabelas: leitura só para autenticado.
-- Views com security_invoker=true precisam do GRANT explícito, mesmo já
-- tendo RLS nas tabelas de origem, porque o Postgres checa privilégio na
-- própria view também.
-- ----------------------------------------------------------------------------
grant select on
  public.v_maquinas_resumo,
  public.v_perda_por_motivo,
  public.v_perda_por_classificacao,
  public.v_downtime_por_status,
  public.v_fardos_mensal,
  public.v_refugo_mensal,
  public.v_ops_refugo,
  public.v_apontamentos_ultimo_dia,
  public.v_refugo_producao_maquina,
  public.v_producao_kg_mensal,
  public.v_scrap_bi_mensal,
  public.v_produtividade_maquina,
  public.v_produtividade_mensal,
  public.v_dados_status
to authenticated;
