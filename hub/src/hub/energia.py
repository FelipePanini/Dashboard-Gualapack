"""Segura o PC acordado enquanto o hub roda.

Desde 08/10/2026 a tarefa agendada acorda o PC hibernado ou em espera (só na
tomada: na bateria o plano de energia não deixa despertador acordar) para o
painel continuar atualizando. Acordado por um despertador, o Windows volta a
dormir uns 2 minutos depois se ninguém mexer, mesmo com o programa no meio do
trabalho: a Aderência de 06/10 parou assim e só terminou na manhã seguinte.

Pedir "sistema necessário" (SetThreadExecutionState) segura o PC acordado até
o fim da execução. Na saída o pedido cai e o Windows volta a dormir sozinho.
Fora do Windows não faz nada.
"""
from __future__ import annotations

import contextlib
import sys

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001


def _kernel32():
    import ctypes
    return ctypes.windll.kernel32


@contextlib.contextmanager
def manter_acordado(kernel32=None):
    k = kernel32 if kernel32 is not None else (_kernel32() if sys.platform == "win32" else None)
    if k is None:
        yield
        return
    k.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    try:
        yield
    finally:
        k.SetThreadExecutionState(ES_CONTINUOUS)
