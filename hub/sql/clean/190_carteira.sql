-- Carteira de pedidos e faturamento (Metrics).
--
-- carteira_aberta: itens de pedido de venda ainda abertos (Liberado, Não
-- liberado, Revisado) com saldo a faturar. Datas vazias do Metrics
-- (30/12/1899) viram vazio.
--
-- A View_usr_ListaPedidosVenda repete o item do pedido uma vez por entrega
-- (junta COMREntregas), e cada repetição traz a quantidade e os kg do item
-- inteiro: somar as linhas contava o mesmo item 2, 3 vezes. As colunas
-- extraídas são todas do item, então as repetições são idênticas e o distinct
-- deixa um item por linha.
create or replace table clean.carteira_item as
select distinct * from raw.banco__carteira;

-- Peso do item em kg. O TotalKG da view é quantidade × PesoEMKG do cadastro,
-- e o PesoEMKG é 1,0 (ou 0) na maioria dos produtos vendidos em m²: em
-- 05/10/2026 a carteira aberta em m² dava 1.599 t pela view contra 225 t pela
-- gramatura. Aqui: em KG, a própria quantidade; em M2, m² × gramatura ÷ 1000,
-- com a gramatura da estrutura do produto (banco.gramatura_produto, a mesma
-- "Gramatura Total" das notas do BI; conferida igual em 1.648 de 1.648
-- produtos faturados) ou, sem ela, a da nota mais recente do produto. Outras
-- unidades (milheiro, metro, cm²) ficam sem peso (kg vazio), nunca chutado.
create or replace table clean.carteira_kg_unidade as
with estrutura as (
  select trim(cod_item) as item, gramatura_total as gramatura
  from raw.banco__gramatura_produto where gramatura_total > 0
), nota as (
  select trim(sku) as item, arg_max(gramatura_total, data_emissao) as gramatura
  from raw.banco__faturamento where gramatura_total > 0 group by 1
)
select distinct trim(c.cod_item_estoque) as item, trim(c.unidade) as unidade,
       case trim(c.unidade) when 'KG' then 1.0
                            when 'M2' then coalesce(e.gramatura, n.gramatura) / 1000 end as kg_por_unidade
from clean.carteira_item c
left join estrutura e on e.item = trim(c.cod_item_estoque)
left join nota n on n.item = trim(c.cod_item_estoque);

create or replace table clean.carteira_aberta as
select trim(c.num_pedido)                                                           as num_pedido,
       nullif(trim(c.nome), '')                                                     as cliente,
       nullif(trim(c.cod_item_estoque), '')                                         as item,
       nullif(trim(c.descricao), '')                                                as produto,
       nullif(trim(c.unidade), '')                                                  as unidade,
       nullif(trim(c.status), '')                                                   as situacao,
       nullif(trim(c.tipo_produto), '')                                             as tipo_produto,
       c.quantidade,
       coalesce(c.quantidade_faturada, 0)                                           as faturada,
       greatest(coalesce(c.quantidade, 0) - coalesce(c.quantidade_faturada, 0), 0)  as saldo,
       c.quantidade * u.kg_por_unidade                                              as kg_total,
       greatest(coalesce(c.quantidade, 0) - coalesce(c.quantidade_faturada, 0), 0) * u.kg_por_unidade as kg_saldo,
       case when c.data_do_pedido > timestamp '1901-01-01' then cast(c.data_do_pedido as date) end          as dt_pedido,
       case when c.data_desejada_cliente > timestamp '1901-01-01' then cast(c.data_desejada_cliente as date) end as entrega_cliente,
       case when c.data_pcp > timestamp '1901-01-01' then cast(c.data_pcp as date) end                      as entrega_pcp,
       case when c.data_negociada > timestamp '1901-01-01' then cast(c.data_negociada as date) end          as entrega_negociada
from clean.carteira_item c
left join clean.carteira_kg_unidade u on u.item = trim(c.cod_item_estoque) and u.unidade = trim(c.unidade)
where trim(c.status) in ('Liberado', 'Não_Liberado', 'Revisado')
  and coalesce(c.quantidade, 0) - coalesce(c.quantidade_faturada, 0) > 0;

-- carteira_mes: kg dos itens de pedido (menos cancelados) pela data que o
-- cliente pediu a entrega, com o mesmo peso de cima. É a "carteira do mês"
-- contra o produzido e o faturado (que também é m² × gramatura).
create or replace table clean.carteira_mes as
select date_trunc('month', cast(c.data_desejada_cliente as date))::date as mes,
       count(*)                                                       as itens,
       count(distinct trim(c.num_pedido))                             as pedidos,
       sum(c.quantidade * u.kg_por_unidade)                           as kg
from clean.carteira_item c
left join clean.carteira_kg_unidade u on u.item = trim(c.cod_item_estoque) and u.unidade = trim(c.unidade)
where c.data_desejada_cliente > timestamp '1901-01-01' and trim(c.status) <> 'Cancelado'
group by 1;

-- faturamento_dia: notas de produto acabado (SKU PA, fatura = S), como a
-- tabela Faturamento do BI Dados de Produção: kg = m² × gramatura total ÷ 1000.
create or replace table clean.faturamento_dia as
select cast(data_emissao as date)                           as dia,
       coalesce(nullif(trim(razao_social), ''), 'Sem cliente') as cliente,
       count(distinct nota_fiscal)                          as notas,
       count(*)                                             as itens,
       sum(coalesce(m2, 0))                                 as m2,
       sum(coalesce(m2, 0) * coalesce(gramatura_total, 0) / 1000) as kg
from raw.banco__faturamento
where data_emissao is not null
group by all;
