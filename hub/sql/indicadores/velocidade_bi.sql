-- Velocidade como o BI calcula (medida DAX "Velocidade" do Dados de Produção):
--   (SUM(BaseVazao[Qtd Produzida]) / SUM(BaseVazao[Horas Produzindo])) / 60
-- por máquina e mês do último dia de produção da OP.
select periodo, maquina as recorte,
       sum(qtd_produzida)                          as numerador,
       sum(horas_produzindo) * 60                  as denominador,
       numerador / nullif(denominador, 0)          as valor
from clean.vazao_bi
cross join cfg.parametros p
where year(periodo) = p.ano
group by periodo, maquina
having sum(horas_produzindo) > 0;
