"""PC acordado durante a execução e espera do banco depois que o agendador acorda o PC."""
import pytest

from hub import energia, sqlserver


class _Kernel32:
    def __init__(self):
        self.chamadas = []

    def SetThreadExecutionState(self, flags):  # noqa: N802 — nome da API do Windows
        self.chamadas.append(flags)
        return 0x80000000


def test_segura_o_pc_acordado_e_solta_no_fim():
    k = _Kernel32()
    with energia.manter_acordado(k):
        assert k.chamadas == [0x80000001]   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    assert k.chamadas == [0x80000001, 0x80000000]


def test_solta_mesmo_quando_a_execucao_falha():
    k = _Kernel32()
    with pytest.raises(SystemExit):
        with energia.manter_acordado(k):
            raise SystemExit(2)
    assert k.chamadas[-1] == 0x80000000


class _Conexao:
    def close(self):
        pass


def _relogio_e_sono():
    agora = [0.0]
    return (lambda: agora[0]), (lambda s: agora.__setitem__(0, agora[0] + s))


def test_banco_de_primeira_nao_espera():
    relogio, dormir = _relogio_e_sono()
    assert sqlserver.aguardar(conectar_fn=_Conexao, dormir=dormir, relogio=relogio) == 0


def test_espera_a_rede_voltar_depois_de_acordar():
    relogio, dormir = _relogio_e_sono()
    falhas = iter([OSError("rede"), OSError("rede")])

    def conectar():
        erro = next(falhas, None)
        if erro:
            raise erro
        return _Conexao()

    assert sqlserver.aguardar(intervalo=15, conectar_fn=conectar, dormir=dormir, relogio=relogio) == 30


def test_desiste_depois_das_tentativas():
    relogio, dormir = _relogio_e_sono()
    tentou = []

    def conectar():
        tentou.append(1)
        raise OSError("sem rede")

    assert sqlserver.aguardar(tentativas=7, intervalo=15, conectar_fn=conectar, dormir=dormir, relogio=relogio) is None
    assert len(tentou) == 7 and relogio() == 90   # 6 esperas de 15 s
