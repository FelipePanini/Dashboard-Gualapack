"""Caminhos sempre relativos à raiz do projeto.

O Agendador de Tarefas do Windows inicia o processo em outra pasta
(C:\\Windows\\System32); nada no projeto pode depender da pasta atual.
"""
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CONFIG = RAIZ / "config"
SQL = RAIZ / "sql"
DADOS = RAIZ / "data"
BANCO = DADOS / "hub.duckdb"
RAW = DADOS / "raw"
LOGS = RAIZ / "logs"
RELATORIOS = RAIZ / "relatorios"
