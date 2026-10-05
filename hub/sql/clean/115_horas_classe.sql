-- Horas por mês × recorte × classe: a base da conferência do Gráficos
-- Tendência (TMR_GRAFICOS_PCT, SETUP_PCT, INATIVO_PCT).
--
-- Vem da tabela Horas do Machine Card, que tem todo o tempo de máquina, com a
-- classe de cada apontamento. Até 30/09 vinha da tabela Dados do BI Dados de
-- Produção; nessa data o dono manteve nela os filtros de WIP e REVISÃO, que
-- também tiram as paradas sem OP (Processo vazio) — sem elas o TMR sobe. A
-- Base Apontamento do Excel tem o mesmo filtro e por isso também não serve.
-- Classe vazia entra como 'SEM CLASSIFICACAO'.
create or replace table clean.horas_classe as
select date_trunc('month', a.dia)::date           as periodo,
       rm.recorte,
       coalesce(a.classe, 'SEM CLASSIFICACAO')    as classe,
       sum(a.horas)                               as horas
from clean.machine_card a
join cfg.recorte_maquina rm on rm.maquina = a.maquina
cross join cfg.parametros p
where year(a.dia) = p.ano
group by all;
