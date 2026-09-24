-- TMR como o Gráficos Tendência mostra (coluna "Produzindo" das abas TMR-*).
select periodo, recorte, produzindo_pct as valor
from clean.tmr_referencia;
