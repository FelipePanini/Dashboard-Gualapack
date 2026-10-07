-- Produção em metros e m² por OP/máquina/dia: a consulta "Produção" do
-- Machine Card (aba Produção (Metros)), refeita direto do banco. Mesmas
-- regras do Power Query dela (lido em 05/10/2026):
--   código 20 (Produzindo), Processo sem WIP/REVISÃO (processo vazio sai),
--   agrupa por OP + máquina + dia (horas e metros somados, descrição, estrutura
--   e tipo de produto pelo maior valor),
--   largura real da estrutura (EstrProcessos.PFmtPagL, a primeira de cada
--   estrutura) e m² = metros × largura ÷ 1000,
--   tipo de produto fora REVISAO/TERUEL e descrição sem "REVISÃO" (sem descrição sai).
-- Conferido em 05/10: jan a set/2026 iguais à planilha (linhas, m² e horas).
-- Máquina sem espaço ("REB 05" -> "REB05") pra casar com o BI.
create or replace table clean.producao_metros as
with g as (
  select num_ordem, cod_recurso, dt_producao,
         sum(qtd_horas) as horas, sum(qtd_produzida) as metros,
         max(des_num_ordem) as descricao, max(cod_est) as cod_est, max(tipo_produto) as tipo_produto
  from raw.banco__apontamentos
  where cod_desc = '20 - Produzindo'
    and processo is not null and not contains(processo, 'WIP') and not contains(processo, 'REVISÃO')
  group by num_ordem, cod_recurso, dt_producao
)
select upper(replace(trim(g.cod_recurso), ' ', ''))  as maquina,
       upper(trim(g.cod_recurso))                    as maquina_painel,
       g.num_ordem,
       cast(g.dt_producao as date)                   as dia,
       g.horas,
       g.metros,
       g.metros * (l.pfmt_pag_l / 1000)              as m2
from g
left join raw.banco__estrutura_largura l on l.cod_estrutura = g.cod_est
where coalesce(g.tipo_produto, '') not in ('REVISAO', 'TERUEL')
  and g.descricao is not null and not contains(g.descricao, 'REVISÃO');
