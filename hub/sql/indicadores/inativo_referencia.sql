-- % Inativo como o Gráficos Tendência mostra (coluna "Inativo" das abas TMR-*).
select periodo, recorte, inativo_pct as valor
from clean.tmr_referencia;
