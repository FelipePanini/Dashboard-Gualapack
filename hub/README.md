# Data hub de produção

Lê as planilhas de uma pasta na Área de Trabalho, padroniza, mede cada
indicador em cada fonte e compara com a fonte oficial. Cada número sai com
status e com a linhagem de onde veio. Roda no PC com Python e um banco local
(DuckDB), sem API do Google e sem copiar planilha para lugar nenhum.

```
pasta compartilhada (originais)       ← você atualiza as planilhas aqui
      │  a cada 30 min: copia o que mudou (espelho)
      ▼
Área de Trabalho\Dados do Painel\     cópias que o hub lê
      │  mudou algo? (Agendador de Tarefas, --se-mudou)
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
Supabase, schema trusted (só agregados)  →  painel: todos os cartões, com as regras
                                            do BI Indicadores Produção, e a página
                                            "Qualidade dos dados"
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
`config/fontes.local.yaml`. Ela guarda **cópias**: as planilhas são mantidas
na pasta compartilhada (`pastas.originais`), onde os vínculos entre elas
funcionam.

- **Atualizar:** trabalhe no original, na pasta compartilhada, e salve. Antes
  de cada execução o hub copia pra pasta de entrada todo original da lista
  `espelho` que estiver mais novo que a cópia (`src/hub/espelho.py`). O
  original nunca é alterado; a cópia substituída fica guardada em
  `data/espelho_substituidos`.
- **Não edite a cópia.** Se a cópia ficar mais nova que o original, o hub
  não sobrescreve e avisa no relatório: a mudança tem de ir pro original.
- **Arquivo do mês e revisões:** o arquivo mensal novo (ex.: "10. ...
  Outubro") entra sozinho quando aparece no original; revisão nova do
  Sequenciamento Acumulado (Rev3) substitui a anterior.
- Pode deixar o Excel aberto; o hub lê uma cópia. Se a cópia da pasta de
  entrada estiver aberta, a troca fica pra próxima execução.
- **Subpastas:** cada arquivo é achado pelo nome em qualquer subpasta. Pode
  reorganizar à vontade; só não deixe duas cópias com o mesmo nome (é erro,
  nunca palpite).
- **Arquivo novo:** aparece no relatório como "não catalogado" até ganhar
  uma entrada no catálogo de fontes.
- **Power BI (.pbix):** o hub lê direto o arquivo — tabelas e fórmulas DAX —
  sem Power BI e sem acesso ao banco, desde que o relatório seja do tipo
  Importação (o dado fica salvo dentro do .pbix). São dois: `Dados_Produção.pbix`
  e `Indicadores de Produção.pbix`, postos direto em "Dados do Painel". O dado
  é o da última atualização salva; `pbi.atualizacao` e `pbi_ind.atualizacao`
  mostram quando foi.
- **Versão antiga no lugar da nova:** arquivo cujo dado vai até antes do que
  o hub já tem (mais de 2 dias) é recusado e a versão anterior continua
  valendo, com erro no relatório. Aconteceu em 25/09 com um
  `Dados_Produção.pbix` atualizado em 06/07. Se for de propósito, marque a
  fonte com `aceita_dado_mais_antigo: true`.
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

- **Todos os cartões** saem de séries por dia que o hub publica e o Supabase
  soma no período escolhido (`sql/supabase/002_cartoes.sql`), com as medidas
  do **BI Indicadores Produção** aplicadas às mesmas planilhas que ele lê:

  | Cartão | Regra (medida do BI) | Tabela |
  |---|---|---|
  | TMR | produzindo ÷ horas sem FIM TURNO e sem INATIVIDADE | Machine Card, tabela Horas |
  | Velocidade | metros ÷ horas produzindo ÷ 60 (VelMédia) | Machine Card, tabela Horas |
  | Paradas | horas por código, fora PRODUZINDO | Machine Card, tabela Horas |
  | Apara apontada | refugo ÷ (refugo + peso bruto das REBs) | Base Aparas, BASE_PROD |
  | Apara confirmada | scrap ÷ (peso bruto das REBs + scrap) | Refugo Aparas + BASE_PROD |
  | Aderência | produzido ÷ planejado (% Realizado Prog) | Aderência Semanal, ADERENCIA_BI |
  | Perda por motivo / máquina, OPs | kg de perda apontada (código 40) | Base Aparas, BASE_DETALHE |
  | Apara por classificação | apontado por grupo de produto (Aparas_Geral v3) | BASE_PROD |

  Os cartões gerais (TMR, aderência, velocidade) são o total do período,
  como no BI, não a média das máquinas. A regra do TMR foi escolhida pelo
  dono em 25/09 (o Gráficos Tendência usa outra; segue conferido à parte).
  Em ago/2026: TMR geral 42,7%, R18 50,7%, apontado 11,49%, confirmado
  14,63%, aderência 76,0%, perda 45.116 kg — iguais ao BI. A linha do tempo
  continua com os apontamentos do BI Dados de Produção. Sem o 002 aplicado,
  o painel segue como era.
- **Página Qualidade dos dados** (`demo/qualidade.html`, ícone de prancheta
  no menu): placar por status, cada indicador mês a mês e recorte a recorte,
  o que corrigir nas planilhas, as fontes e os avisos.

Só sai do PC o que é agregado: horas e metros por máquina/dia/código, peso
bruto e refugo por OP/dia (com a descrição do produto), perda por
OP/dia/tipo, programado × produzido por OP/dia, kg e m² por máquina/dia, os
eventos do último dia (máquina, código, início, fim, OP), valores por mês e
recorte, o catálogo de indicadores, o estado de cada fonte (sem caminho de
arquivo) e os avisos (com os caminhos apagados). Nada de operador,
observação ou cliente. As séries vão um mês por vez e só o mês que mudou; o
Supabase confirma quantas linhas gravou, senão o mês vai de novo.

Os cartões ficam tão atuais quanto as planilhas da pasta compartilhada (a
cópia automática traz o que mudou); o BI Indicadores Produção é a conferência.

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
4. No **SQL Editor** → rodar `sql/supabase/002_cartoes.sql` (os cartões). A
   última consulta tem de mostrar `funcoes_ok = true`.
5. Aqui em `hub/`: `uv run hub publicar`. Envia tudo da última execução
   (o histórico leva uns segundos). Recarregue o painel.

Feitos em 25/09: os passos 1 a 3. Falta o 4 e o 5.

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
| 🔴 Erro | Valor impossível (fora de 0–100%, ou do `faixa_max` do indicador) ou fonte comparada sem o período |
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

- **30 fontes** catalogadas: as planilhas (copiadas da pasta compartilhada)
  e os dois BIs (Dados de Produção e Indicadores Produção).
- **14 indicadores:** 675 validados, 15 divergentes, 86 aguardando, 0 erros.
  Tudo o que o painel mostra (TMR, velocidade, apara apontada e confirmada,
  aderência, perda) bate com o BI Indicadores Produção em todos os meses
  fechados de 2026, e a perda bate também com o BI Dados de Produção.
  Os 15 divergentes são células do Gráficos Tendência (TMR pela regra dele,
  inativo, volume do corte); o relatório lista cada uma na seção "O que
  corrigir nas planilhas". Decisão de 25/09: as planilhas não serão
  corrigidas; as divergências ficam à vista na página Qualidade dos dados.
- **Achado 5 (25/09):** o painel mostrava como "apontado" a apara dos
  fardos (6,58% em agosto) e como "confirmado" scrap ÷ produção (17,14%). No
  BI são outras contas: 11,49% e 14,63%.
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

1. Rodar o `002_cartoes.sql` e `uv run hub publicar` (passos 4 e 5 de
   "Publicar no painel"). Com isso nenhum cartão depende mais do Google
   Drive, a não ser a lista de máquinas e grupos, que ainda vem do fluxo antigo.
2. Produtividade: o painel mostra m² ÷ hora de máquina. A do BI (m² ÷ hora
   trabalhada) depende de duas planilhas paradas (Produção M² em jan/2026,
   Disponibilidade em fev/2026) e da planilha de horas de pessoas.
3. Desligar o fluxo antigo (Google Drive + GitHub Actions) quando o dono
   confirmar que o painel pelo hub está certo.
