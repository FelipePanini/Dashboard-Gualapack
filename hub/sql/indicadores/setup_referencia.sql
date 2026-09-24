-- % Setup como o Gráficos Tendência mostra (coluna "Setup" das abas TMR-*).
select periodo, recorte, setup_pct as valor
from clean.tmr_referencia;
