-- Tabela "Horas" do Machine Card: um apontamento por linha, com a
-- classificação de horas (PRODUZINDO, FIM TURNO...). É a mesma tabela que o
-- BI Indicadores Produção usa pro TMR e pra velocidade.
--
-- Direto do banco desde 05/10/2026, como a consulta "Horas" da planilha (lida
-- do Power Query): todas as linhas da view de apontamentos, código de
-- apontamento como número, classificação pela tabela-padrão (clean.classificacao).
-- Conferido em 05/10: 18 dos 22 meses de jan/2025 a out/2026 iguais à
-- planilha linha a linha; os outros 4 eram planilha desatualizada (setembro
-- atualizado antes do fim do mês) e lote incluído no banco depois (fev–abr/2025).
-- classe vazia fica NULL: o BI conta essas horas no total (não são FIM TURNO
-- nem INATIVIDADE), então as regras usam coalesce(classe, '').
create or replace table clean.machine_card as
select cast(a.dt_producao as date)                                 as dia,
       upper(trim(a.cod_recurso))                                  as maquina,
       case when length(cast(try_cast(a.cod_apont as integer) as varchar)) = 1
            then '0' || cast(try_cast(a.cod_apont as integer) as varchar)
            else cast(try_cast(a.cod_apont as integer) as varchar) end as cod_apont,
       a.cod_desc,
       nullif(c.classe_tmr, '')                                    as classe,
       a.qtd_horas                                                 as horas,
       a.qtd_produzida                                             as metros,
       a.num_ordem
from raw.banco__apontamentos a
left join clean.classificacao c on try_cast(c.cod as integer) = try_cast(a.cod_apont as integer)
where a.dt_producao is not null and a.cod_recurso is not null;
