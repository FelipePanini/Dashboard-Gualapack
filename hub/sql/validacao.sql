-- ============================================================================
-- validacao.sql — compara cada fonte com a fonte OFICIAL do indicador, por
-- período e recorte, na mesma execução ($run).
--
-- Precedência do status (a primeira regra que bate vence):
--   erro > desatualizado > aguardando > divergente > validado
-- Indicador sem fonte de comparação ("fonte única") passa só por faixa e
-- frescor e, se ok, fica "validado" com esse motivo.
-- ============================================================================
insert into validation_results
with med as (
  select m.*, i.fonte_oficial, m.source_id = i.fonte_oficial as eh_oficial
  from measurements m
  join indicators i on i.codigo = m.indicador and i.versao = m.versao
  where m.run_id = $run
), oficial as (
  select * from med where eh_oficial
), comparado as (
  select * from med where not eh_oficial
), pares as (
  select coalesce(c.indicador, o.indicador) as indicador,
         coalesce(c.versao, o.versao)       as versao,
         coalesce(c.periodo, o.periodo)     as periodo,
         coalesce(c.recorte, o.recorte)     as recorte,
         coalesce(o.fonte_oficial, c.fonte_oficial) as fonte_oficial,
         o.valor    as valor_oficial,   o.dado_ate as ate_oficial,
         c.source_id as fonte_comparada, c.valor as valor_comparado, c.dado_ate as ate_comparado
  from comparado c
  full join oficial o
         on o.indicador = c.indicador and o.periodo = c.periodo and o.recorte = c.recorte
), avaliado as (
  select p.*, i.unidade, i.tolerancia_abs, i.tolerancia_pct, coalesce(i.faixa_max, 100) as faixa_max,
         -- comparação opcional: a comparada só existe em alguns períodos (ex.: arquivo
         -- mensal de fardos só do mês corrente); sem ela, o período vale como fonte única
         case when coalesce(i.comparacao_opcional, false) then null else i.fontes_comparadas end
                                                                   as comparacao_obrigatoria,
         i.fontes_comparadas,
         p.valor_comparado - p.valor_oficial as dif_abs,
         (p.valor_comparado - p.valor_oficial) / nullif(abs(p.valor_oficial), 0) as dif_pct,
         p.periodo >= date_trunc('month', current_date) as periodo_aberto,
         (p.ate_oficial < last_day(p.periodo) or p.ate_comparado < last_day(p.periodo)) as sem_cobertura
  from pares p
  join indicators i on i.codigo = p.indicador and i.versao = p.versao
)
select $run, indicador, periodo, recorte, fonte_oficial, valor_oficial,
       fonte_comparada, valor_comparado, dif_abs, dif_pct,
       case
         when unidade = 'pct' and (valor_oficial not between 0 and faixa_max
                                or valor_comparado not between 0 and faixa_max)    then 'erro'
         when not periodo_aberto and sem_cobertura                                 then 'desatualizado'
         when periodo_aberto                                                       then 'aguardando'
         when valor_oficial is null                                                then 'aguardando'
         when comparacao_obrigatoria is not null and valor_comparado is null       then 'erro'
         when valor_comparado is null                                              then 'validado'
         when abs(dif_abs) <= coalesce(tolerancia_abs, 0)
           or abs(dif_abs) <= coalesce(tolerancia_pct, 0) * abs(valor_oficial)    then 'validado'
         else 'divergente'
       end as status,
       case
         when unidade = 'pct' and (valor_oficial not between 0 and faixa_max
                                or valor_comparado not between 0 and faixa_max)
           then 'valor fora da faixa 0–' || cast(faixa_max as integer) || '%'
         when not periodo_aberto and sem_cobertura then
           'dado vai só até ' || strftime(least(coalesce(ate_oficial, ate_comparado),
                                               coalesce(ate_comparado, ate_oficial)), '%d/%m/%Y')
         when periodo_aberto                                                       then 'mês em andamento'
         when valor_oficial is null                                                then 'fonte oficial ainda sem este período'
         when comparacao_obrigatoria is not null and valor_comparado is null       then 'fonte comparada sem este período'
         when valor_comparado is null and fontes_comparadas is not null            then 'sem comparação neste período: conferidos faixa e frescor'
         when valor_comparado is null                                              then 'fonte única: conferidos faixa e frescor'
         when abs(dif_abs) <= coalesce(tolerancia_abs, 0)
           or abs(dif_abs) <= coalesce(tolerancia_pct, 0) * abs(valor_oficial)    then 'dentro da tolerância'
         else 'diferença acima da tolerância'
       end as motivo
from avaliado;
