-- Velocidade pela regra que o painel web usa hoje (rpc_produtividade_maquina):
-- metros produzidos ÷ minutos de produção, a partir do Machine Card.
-- Só as máquinas que o BI também mede, pra comparação ser do mesmo universo.
select date_trunc('month', dia)::date              as periodo, maquina as recorte,
       sum(metros)                                 as numerador,
       sum(horas) * 60                             as denominador,
       numerador / nullif(denominador, 0)          as valor
from clean.producao_metros
cross join cfg.parametros p
where year(dia) = p.ano
  and maquina in (select distinct maquina from clean.vazao_bi)
group by 1, 2
having sum(horas) > 0;
