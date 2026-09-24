-- Produção do mês em kg como está no Gráficos Tendência (bloco "Volume Corte (JGR + OF)").
select periodo, 'TOTAL' as recorte, kg as valor
from clean.volume_corte;
