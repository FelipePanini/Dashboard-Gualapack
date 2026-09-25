"""Publicação: o pacote que vai pro Supabase (sem rede nos testes)."""
import json
from datetime import date
from pathlib import Path

from hub import db, publicacao


def _con_com_dados(pasta: Path):
    con = db.conectar(":memory:")
    con.execute("insert into processing_runs (gatilho, status) values ('teste', 'ok')")
    con.execute("insert into sources (id, tipo, descricao, dono, frescor_dias) values "
                "('graficos.tmr', 'excel_bloco', 'TMR da planilha', 'Produção', 0)")
    con.execute("""insert into files (source_id, run_id, caminho, sha256, status, dado_ate, linhas)
                   values ('graficos.tmr', 1, ?, 'abc', 'novo', null, 98)""", [str(pasta / "Graficos Tendência.xlsx")])
    con.execute("""insert into indicators (codigo, versao, nome, unidade, grao, definicao, regra_sql, fonte_oficial,
                     correcao) values ('TMR_PCT', 1, 'TMR', 'pct', 'mes', 'def', 'x.sql', 'graficos.tmr',
                     'aba TMR - {recorte} › linha {mes} = {valor_comparado}')""")
    con.execute("""insert into validation_results values
                   (1, 'TMR_PCT', '2026-01-01', 'Flexo', 'graficos.tmr', 37.7, 'hub.calculo', 41.76, 4.06, 0.108, 'divergente', 'acima'),
                   (1, 'TMR_PCT', '2026-03-01', 'Flexo', 'graficos.tmr', 35.9, 'hub.calculo', 35.9, 0, 0, 'validado', 'ok')""")
    con.execute("insert into errors (run_id, source_id, gravidade, codigo, mensagem) values (1, null, 'aviso', 'x', ?)",
                [f"0 arquivo(s) em {pasta}\\Indicadores"])
    return con


def test_pacote(tmp_path):
    con = _con_com_dados(tmp_path)
    cfg = {"pasta_entrada": tmp_path, "indicadores": [{
        "codigo": "TMR_PCT", "versao": 1, "nome": "TMR", "unidade": "pct", "grao": "mes",
        "definicao": "Horas  produzindo\n  ÷ horas", "fonte_oficial": "graficos.tmr",
        "medicoes": [{"fonte": "graficos.tmr"}, {"fonte": "hub.calculo"}]}]}
    pacote = publicacao.montar_pacote(con, 1, cfg)

    json.dumps(pacote)  # precisa virar JSON sem conversor especial
    assert pacote["execucao"]["id"] == 1 and pacote["execucao"]["status"] == "ok"
    assert pacote["indicadores"][0]["definicao"] == "Horas produzindo ÷ horas"
    assert pacote["indicadores"][0]["fontes_comparadas"] == "hub.calculo"
    por_mes = {v["periodo"]: v for v in pacote["validacao"]}
    assert por_mes["2026-01-01"]["correcao"] == "aba TMR - Flexo › linha Janeiro = 41,76%"
    assert por_mes["2026-03-01"]["correcao"] is None               # só divergência ganha instrução
    assert pacote["fontes"][0]["fonte"] == "graficos.tmr"
    assert "caminho" not in pacote["fontes"][0]                     # caminho de arquivo não sai do PC
    assert str(tmp_path) not in pacote["avisos"][0]["mensagem"]


def test_config_supabase_le_o_arquivo_do_painel(tmp_path):
    js = tmp_path / "supabase-config.js"
    js.write_text('window.SUPABASE_CONFIG = {\n  url: "https://x.supabase.co",\n  anonKey: "abc",\n'
                  '  registerFunctionUrl: "https://x.supabase.co/functions/v1/super-action",\n};', encoding="utf-8")
    cfg = publicacao.config_supabase(js)
    assert cfg == {"url": "https://x.supabase.co", "anon_key": "abc",
                   "cadastro_url": "https://x.supabase.co/functions/v1/super-action"}


def test_publicacao_desligada_ou_sem_usuario_nao_quebra(tmp_path, monkeypatch):
    con = _con_com_dados(tmp_path)
    assert publicacao.publicar(con, 1, {"publicacao": {"ativa": False}}).startswith("desligada")
    monkeypatch.setattr(publicacao, "senha_do_cofre", lambda email: None)
    assert publicacao.publicar(con, 1, {"publicacao": {"ativa": True, "email": "x@y.invalid"}}).startswith("sem usuário")
