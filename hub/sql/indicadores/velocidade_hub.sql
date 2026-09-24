-- Velocidade pela regra do BI (consulta BaseVazao + medida "Velocidade" do
-- Dados de Produção), recalculada a partir dos apontamentos do BI:
--   1. só apontamentos do ano;
--   2. agrupa por OP + processo + máquina: Data Max = último dia, Qtd Produzida
--      = soma da produção, Horas Produzindo = horas com código 20;
--   3. descarta: Qtd Produzida <= 10, processo com WIP ou REVISÃO (ou vazio),
--      descrição com REVISÃO (ou vazia), Horas Produzindo = 0;
--   4. Velocidade = SUM(Qtd Produzida) / SUM(Horas Produzindo) / 60, no mês do Data Max.
with por_op as (
  select a.num_ordem, a.processo, replace(a.maquina, ' ', '') as maquina,
         max(a.dia)                                              as data_max,
         round(sum(a.qtd_produzida))                             as qtd_produzida,  -- o BI converte pra inteiro
         sum(case when a.cod_apont = '20' then a.horas else 0 end) as horas_produzindo,
         max(a.descricao)                                        as descricao
  from clean.pbi_apontamento a
  cross join cfg.parametros p
  where a.dia >= make_date(p.ano, 1, 1)
  group by 1, 2, 3
)
select date_trunc('month', data_max)::date          as periodo, maquina as recorte,
       sum(qtd_produzida)                           as numerador,
       sum(horas_produzindo) * 60                   as denominador,
       numerador / nullif(denominador, 0)           as valor
from por_op
where qtd_produzida > 10
  and processo is not null and not contains(processo, 'WIP') and not contains(processo, 'REVISÃO')
  and descricao is not null and not contains(descricao, 'REVISÃO')
  and horas_produzindo <> 0
group by 1, 2;
