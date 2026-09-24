-- Horas por mês × recorte × classe oficial: a base dos indicadores de TMR.
--
-- Vem do BI (tabela Dados do .pbix), não da Base Apontamento do Excel.
-- Decidido por evidência em 24/09: a Base Apontamento do Indicadores Diário
-- está com apontamentos faltando (R18 em agosto: 171 h a menos; Roto: menos
-- da metade das horas), e o BI tem o mês inteiro. Com o BI, o TMR bate com o
-- Gráficos Tendência (Corte igual em todos os meses; R18, L04 e Roto com
-- erro médio abaixo de 0,3 p.p.). A diferença entre as duas cópias aparece
-- no indicador HORAS_APONTADAS.
-- Código sem cadastro entra como 'SEM CLASSIFICACAO'.
create or replace table clean.horas_classe as
select date_trunc('month', a.dia)::date           as periodo,
       rm.recorte,
       coalesce(c.classe, 'SEM CLASSIFICACAO')    as classe,
       sum(a.horas)                               as horas
from clean.pbi_apontamento a
join cfg.recorte_maquina rm     on rm.maquina = a.maquina
left join clean.classificacao c on c.cod = a.cod_apont
cross join cfg.parametros p
where year(a.dia) = p.ano
group by all;
