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
relatorios/qualidade.html + validacao.csv + correcoes.csv
      ▼
Supabase, schema trusted (só agregados)  →  painel: TMR, paradas, linha do tempo
                                            e página "Qualidade dos dados"
```

Nenhuma etapa usa IA. A atualização é determinística e não gasta tokens.

## Rodar

```powershell
cd hub
uv run hub                # coleta, valida e gera relatorios/qualidade.html
uv run hub --se-mudou     # só roda se algo mudou (é o que o agendador chama)
uv run hub relatorio      # só refaz o relatório da última execução
uv run hub publicar       # reenvia tudo pro Supabase (primeira vez, ou se lá se perdeu)
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
- **Fardos:** o histórico do ano vem do Sequenciamento Acumulado (aba Base
  Aparas Total); o arquivo mensal cobre o mês corrente, que é mais atual.
  Mês que tem arquivo mensal usa o mensal; os outros, o Acumulado. Nos meses
  em que os dois existem, o hub compara as duas cópias.
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

## Publicar no painel

Ao fim de cada execução o hub publica no Supabase, e o painel usa de dois
jeitos:

- **Cartões de TMR, paradas e linha do tempo** passam a sair dos
  apontamentos do BI (horas por máquina, dia e código), com a regra que
  reproduz o Gráficos Tendência: PRODUZINDO ÷ (horas − FIM TURNO). Antes
  saíam da Base Apontamento do Excel, que perde as paradas sem OP: em
  agosto o TMR do painel ficava de 4 a 29 p.p. acima do BI (L02 50% contra
  21%, R18 51% contra 37%). Enquanto o hub não publica, o painel segue como
  era.
- **Página Qualidade dos dados** (`demo/qualidade.html`, ícone de prancheta
  no menu): placar por status, cada indicador mês a mês e recorte a recorte,
  o que corrigir nas planilhas, as fontes e os avisos.

Só sai do PC o que é agregado: horas por máquina/dia/código, os eventos do
último dia (máquina, código, início, fim, OP), valores por mês e recorte, o
catálogo de indicadores, o estado de cada fonte (sem caminho de arquivo) e os
avisos (com os caminhos apagados). Nada de operador, observação ou cliente.
As horas vão um mês por vez e só o mês que mudou.

O TMR do painel fica tão atual quanto o `Dados_Produção.pbix` da pasta de
entrada: troque o arquivo quando o BI for atualizado, como as planilhas.

A escrita é feita por um **usuário técnico** do painel, só dele: a função
`public.hub_publicar` confere a tabela `trusted.escritores` e troca os dados
numa transação só. Quem está logado no painel só lê (views `public.v_hub_*`).
A senha do usuário técnico é gerada ao acaso e fica no Cofre de Credenciais
do Windows (serviço `gualapack-hub`); não fica em arquivo nem no git.

Uma vez só, nesta ordem:

1. No painel, **Administração de acessos** → gerar uma chave de convite
   (perfil Visualizador, 1 uso).
2. Aqui em `hub/`: `uv run python scripts/criar_usuario_hub.py` e colar a
   chave quando pedir. O script cria o usuário e guarda a senha no Cofre.
3. No Supabase, **SQL Editor** → rodar `sql/supabase/001_trusted.sql`. A
   última consulta tem de mostrar `autorizado = true`.
4. Aqui em `hub/`: `uv run hub publicar`. Envia tudo da última execução
   (o histórico de horas leva uns segundos). Recarregue o painel.

Depois disso cada execução publica sozinha. `uv run hub publicar` também
serve pra reenviar tudo se o dado do Supabase se perder. Com
`publicacao.ativa: false` no `fontes.local.yaml` o hub só gera o relatório
local. Se a publicação falhar (sem rede, por exemplo), a execução continua,
o motivo vira aviso no relatório e a próxima tenta de novo.

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

## Situação em 25/09/2026

- **21 fontes** catalogadas, incluindo o BI Dados de Produção. Primeira
  leitura de tudo: ~95 s; depois, só o que mudou.
- **8 indicadores:** 339 validados, 15 divergentes, 44 aguardando, 0 erros.
  Os 15 divergentes são células do Gráficos Tendência desatualizadas ou
  erradas; o relatório lista cada uma na seção "O que corrigir nas
  planilhas" (também em `relatorios/correcoes.csv`), com o valor certo.
  Decisão de 25/09: as planilhas não serão corrigidas; as divergências
  ficam à vista na página Qualidade dos dados.
- **Base Apontamento do Excel:** a consulta dela descarta parada sem OP, OP
  de WIP e revisão (filtro lido do Power Query da planilha). Com o mesmo
  filtro, BI e planilha batem nos 56 meses. Ela não serve pra TMR — e é dela
  que o painel web atual calcula o TMR.
- **Velocidade:** o hub recalcula a regra do BI (consulta BaseVazao) a partir
  dos apontamentos e bate com o BI em 106 de 106 meses. O painel web atual
  usa outra regra (Machine Card, por dia).
- **TMR resolvido.** Com os apontamentos do BI, a regra PRODUZINDO ÷
  (horas − FIM TURNO) e Flexo = R12 + R18 + R20, o hub reproduz o Gráficos
  Tendência. O TMR tem 49 meses validados, o Setup 56 de 56.
- **Achado 1:** a Base Apontamento do Indicadores Diário está com
  apontamentos faltando (Roto com menos da metade das horas do BI). Era a
  origem das divergências de TMR.
- **Achado 2:** em jan e fev o Gráficos Tendência deixou a R12 fora do Flexo,
  mesmo com ela apontando. No Machine Card a R12 está como FUNGICIDA.
- **Achado 3:** a velocidade do painel web bate com a do BI (menos de 1%)
  na maioria das máquinas. Fogem HMC01 em julho, REB05 e REB10 em agosto.
- **Achado 4:** a apara apontada de agosto é 6,99% no Acumulado; o painel
  web mostra 6,58%, vindo do arquivo mensal de agosto.
- **SQL Server:** fora por enquanto (decisão de 24/09); o hub trabalha só
  com as planilhas e o .pbix.

## Próximos passos

1. Indicadores de aparas, refugo, aderência e produtividade a partir das
   fontes já catalogadas (as que o painel web mostra).
2. Publicação no Supabase: pronta no hub e no painel (TMR, paradas, linha
   do tempo e página de qualidade); falta fazer os quatro passos de
   "Publicar no painel" (o SQL ainda não foi aplicado).
3. Levar para o hub o resto do que o painel mostra (aparas por máquina,
   aderência, velocidade, produtividade). Aí o upload para o Google Drive
   deixa de ser necessário.
