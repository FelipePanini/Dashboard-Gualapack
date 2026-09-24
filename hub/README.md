# Data hub de produção

Lê as planilhas de uma pasta na Área de Trabalho, padroniza, mede cada
indicador em cada fonte e compara com a fonte oficial. Cada número sai com
status e com a linhagem de onde veio. Roda no PC com Python e um banco local
(DuckDB), sem API do Google e sem copiar planilha para lugar nenhum.

```
Área de Trabalho\Dados do Painel\     ← você atualiza as planilhas aqui
      │  a cada 30 min: mudou algo? (Agendador de Tarefas, --se-mudou)
      ▼
coleta: contrato de colunas, SHA-256, data máxima do dado
      ▼
data/hub.duckdb
  raw.*     cópia fiel da última versão boa (+ parquet por versão em data/raw/)
  clean.*   tipos, códigos e recortes padronizados       (sql/clean/)
  checagens de qualidade → errors                        (sql/checagens/)
  measurements: indicador × mês × recorte × fonte        (sql/indicadores/)
  validation_results: comparação com a fonte oficial     (sql/validacao.sql)
      ▼
relatorios/qualidade.html + validacao.csv    (próximo: Supabase, schema trusted)
```

Nenhuma etapa usa IA. A atualização é determinística e não gasta tokens.

## Rodar

```powershell
cd hub
uv run hub                # coleta, valida e gera relatorios/qualidade.html
uv run hub --se-mudou     # só roda se algo mudou (é o que o agendador chama)
uv run hub relatorio      # só refaz o relatório da última execução
uv run pytest             # testes
```

Primeira vez num PC novo: instalar o uv (`winget install --id astral-sh.uv -e --scope user`)
e rodar `uv sync` dentro de `hub/`. Não precisa de administrador.

## Pasta de entrada

`Área de Trabalho\Dados do Painel` — o caminho está em `pastas.entrada` no
`config/fontes.local.yaml`.

- **Atualizar:** substitua a planilha pelo arquivo novo, com o mesmo nome.
  Pode deixar o Excel aberto; o hub lê uma cópia.
- **Subpastas:** cada arquivo é achado pelo nome em qualquer subpasta. Pode
  reorganizar à vontade; só não deixe duas cópias com o mesmo nome (é erro,
  nunca palpite).
- **Arquivo novo:** aparece no relatório como "não catalogado" até ganhar
  uma entrada no catálogo de fontes.
- **Power BI (.pbix):** o hub lê direto o arquivo — tabelas e fórmulas DAX —
  sem Power BI e sem acesso ao banco, desde que o relatório seja do tipo
  Importação (o dado fica salvo dentro do .pbix). O dado é o da última vez que
  o .pbix foi atualizado e salvo; a fonte `pbi.atualizacao` mostra quando foi.
- **Um arquivo por mês:** os Sequenciamentos mensais de fardos são lidos
  todos juntos; é só ir acrescentando o arquivo do mês.
- **Nome com revisão:** o Sequenciamento Acumulado aceita "Rev2", "Rev3"...
  mas só um por vez.
- **Arquivo que derruba o leitor rápido de Excel** (hoje: Refugo Aparas) é
  lido pelo leitor alternativo, mais lento, e vira aviso no relatório.

## Execução automática

Tarefa "Gualapack Data Hub" no Agendador de Tarefas do Windows. Ela roda a
cada 30 minutos com o usuário logado, sem abrir janela. Só processa se algo
mudou na pasta ou na configuração, e ao menos uma vez por dia (o frescor
depende da data de hoje). O registro fica em `logs/hub-AAAA-MM.log`.

```powershell
schtasks /Query /TN "Gualapack Data Hub"     # ver
schtasks /Run /TN "Gualapack Data Hub"       # rodar agora
schtasks /Delete /TN "Gualapack Data Hub" /F # remover
```

## Configuração

| Arquivo | Vai pro git? | O quê |
|---|---|---|
| `config/fontes.local.yaml` | **Não** | Pasta de entrada, planilhas, abas, colunas obrigatórias, frescor. Modelo em `fontes.exemplo.yaml` |
| `config/sqlserver.local.yaml` | **Não** | Servidor do SQL Server (fase futura) |
| `config/indicadores.yaml` | Sim | Catálogo: definição, dono, fonte oficial, tolerância, regras |
| `config/recortes.yaml` | Sim | Quais máquinas formam cada recorte (Flexo, Corte...) |

O repositório é público: caminho interno, nome de servidor, dado e relatório
ficam só no PC (`.gitignore`).

## Status

| Status | Quando |
|---|---|
| ✅ Validado | Diferença dentro da tolerância. Em fonte única: faixa e frescor ok |
| ⚠️ Divergente | Diferença acima da tolerância |
| 🔴 Erro | Valor impossível (fora de 0–100%) ou fonte comparada sem o período |
| 🟡 Desatualizado | Mês fechado, mas o dado de alguma fonte para antes do fim do mês |
| 🔵 Aguardando | Mês em andamento, ou fonte oficial ainda sem o período |

A primeira regra que bate vence, nesta ordem: erro, desatualizado,
aguardando, divergente, validado.

## Como acrescentar

- **Uma fonte:** coloque o arquivo na pasta de entrada e crie uma entrada em
  `fontes.local.yaml`, com as colunas obrigatórias. Se a aba mudar de
  formato, a coleta falha alto e o dado anterior continua valendo.
- **Um indicador:** entrada em `indicadores.yaml` e um SQL por fonte em
  `sql/indicadores/`. Cada SQL devolve `periodo, recorte, valor` e, se
  tiver, `numerador, denominador`.
- **Uma checagem:** um SQL em `sql/checagens/` que devolve
  `source_id, gravidade, codigo, mensagem`.
- **Mudou a regra de um indicador:** suba a `versao` no catálogo.

## Situação em 24/09/2026

- **20 fontes** catalogadas, incluindo o BI Dados de Produção. Primeira
  leitura de tudo: ~95 s; depois, só o que mudou.
- **7 indicadores:** 245 validados, 99 divergentes, 44 aguardando, 2 erros.
- **TMR resolvido.** Com os apontamentos do BI e a regra PRODUZINDO ÷
  (horas − FIM TURNO), o hub reproduz o Gráficos Tendência. O Corte bate
  igual em todos os meses, e R18, L04 e Roto ficam abaixo de 0,3 p.p. de
  erro médio.
- **Achado 1:** a Base Apontamento do Indicadores Diário está com
  apontamentos faltando (Roto com menos da metade das horas do BI). É
  essa a origem das divergências de TMR.
- **Achado 2:** o recorte Flexo do Gráficos Tendência inclui a R12 em alguns
  meses e em outros não.
- **Achado 3:** a velocidade do painel web bate com a do BI (menos de 1%)
  na maioria das máquinas. Fogem HMC01 em julho, REB05 e REB10 em agosto.
- **SQL Server:** fora por enquanto (decisão de 24/09); o hub trabalha só
  com as planilhas e o .pbix.

## Próximos passos

1. Confirmar com o dono do indicador qual é o Flexo certo (com ou sem R12).
2. Indicadores de aparas, refugo, aderência e produtividade a partir das
   fontes já catalogadas (as que o painel web mostra).
3. Publicar no Supabase (`sql/supabase/001_trusted.sql`, ainda não aplicado)
   para o painel web ler do hub. Aí o upload para o Google Drive deixa de ser
   necessário.
