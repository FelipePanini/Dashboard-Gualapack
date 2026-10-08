# Data hub de produção

Lê o banco da fábrica (Metrics, só leitura) e as planilhas de lançamento
manual, padroniza, aplica as regras dos BIs de Produção, mede cada indicador
em cada fonte e compara com a fonte oficial. Cada número sai com status e com
a linhagem de onde veio. Roda num PC da rede da fábrica, com Python e um banco
local (DuckDB).

```
SQL Server da fábrica (Metrics)          pasta compartilhada (originais)
      │  só leitura, a cada 10 min              │  a cada 10 min: copia o que mudou (espelho)
      ▼                                         ▼
data/extracao/banco/*.parquet            Área de Trabalho\Dados do Painel\
      └─────────────────┬───────────────────────┘
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
Supabase, schema trusted (agregados e      →  painel: os cartões, com as regras dos
fotos pequenas do estado atual)                BIs, as telas do banco e a página
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

## Banco da fábrica (desde 05/10)

As planilhas e os BIs leem as mesmas views do banco (Metrics); cada um só
aplica filtros diferentes. O hub lê as views direto, com os filtros dos Power
Query, e as planilhas e os BIs viraram conferência.

- **Só leitura:** usuário de leitura que o TI liberou, conexão com
  `ApplicationIntent=ReadOnly` e uma trava no código (`sqlserver.so_leitura`)
  que só deixa passar uma consulta (SELECT ou WITH). INSERT, UPDATE, DELETE,
  MERGE, EXEC, CREATE, ALTER, DROP, TRUNCATE, SELECT INTO e afins são
  recusados antes de chegar ao banco. Usuário e senha ficam só no Cofre de
  Credenciais do Windows: quem guarda é você, rodando
  `scripts/guardar_acesso_banco.py` (a senha não aparece, não vai pra arquivo
  nem pro git). Servidor e banco ficam em `config/sqlserver.local.yaml`, fora
  do git. Sem conexão, o hub avisa e segue com o que já tinha; não há mais
  caminho pelo Excel.
- **Mapa do banco:** `scripts/mapear_banco.py` lista tabelas, views e colunas
  que o acesso enxerga (só catálogo, nenhum dado) em `data/mapa_banco/`.
- **Apontamentos** (`banco.py`): `View_usr_apontamentos_999999`, um parquet
  por mês em `data/extracao/banco` desde jan/2025, só nas colunas usadas
  (nunca nome de operador nem observação). Cada execução relê os 2 meses mais
  recentes e os que faltam, e só regrava um mês quando o dado mudou; mês que
  volta vazio não apaga o anterior. A fonte `banco.apontamentos` empilha os
  meses.
- **As outras leituras** (`extracoes.py`), cada uma no seu intervalo. Uma
  leitura com erro não derruba as outras: vira aviso e o arquivo anterior
  continua valendo.

  | Fonte | No banco | Como |
  |---|---|---|
  | `banco.estrutura_largura` | `EstrProcessos` | foto a cada 6 h: largura de cada estrutura (m² da produção) |
  | `banco.maquina_agora` | `CTREntradasMaquina`, status 1 | foto: a OP aberta em cada máquina |
  | `banco.programacao` | `view_usr_ProgramacaoPlanner` | foto: a fila (alocado, não finalizado) |
  | `banco.programacao_pcp` | `View_usr_programacao_teruel` | foto a cada 1 h, e a primeira de cada dia guardada em `historico/` |
  | `banco.wip` | `view_usr_pallet_wip_disponiveis` | foto |
  | `banco.gramatura_produto` | `EstrComponentes` + `EstruturasOp` | foto a cada 6 h: gramatura de cada produto |
  | `banco.carteira` | `View_usr_ListaPedidosVenda` | foto a cada 10 min, sem preço nem vendedor |
  | `banco.faturamento` | `view_usr_notas_saida_entrada_custo` | por mês: notas de produto acabado |
  | `banco.entregas` | `View_usr_Entregas_Desempenho` | por mês: a consulta e a classificação da Aderência Semanal |
  | `banco.setup` | `View_usr_Acompanhamento_Prod` | por mês, a cada 30 min |
  | `banco.laudos` | `view_usr_LaudoAnalise` | por mês, desde jan/2026, sem o analista |

- **Regras:** a tabela Horas do Machine Card (TMR, velocidade, paradas), a
  perda código 40, a BASE_PROD (apara apontada e peso bruto) e a produção em
  m² são montadas dos apontamentos, como os Power Query das planilhas. A
  classe de cada código vem de `config/classificacao_apontamentos.csv`, cópia
  da tabela-padrão `Classificação_Apontamentos.xlsx` (113 códigos). Código
  novo aparece como "SEM CLASSIFICACAO" e na checagem 010 até entrar no CSV.
- **Carteira:** a view repete o item do pedido uma vez por entrega (junta
  `COMREntregas`), com a quantidade do item inteiro em cada repetição; o hub
  conta um item por linha. E o `TotalKG` dela usa o `PesoEMKG` do cadastro,
  que é 1,0 (ou 0) na maioria dos produtos vendidos em m². O hub pesa em KG
  pela própria quantidade e em M2 por m² × gramatura da estrutura ÷ 1000 (a
  mesma "Gramatura Total" das notas, igual em 1.648 de 1.648 produtos
  faturados). Milheiro, metro e cm² ficam sem peso, e o painel diz quantos.
  Em 05/10: carteira aberta 811 t, onde a view somava 2.190 t; em agosto, 306
  t pedidas, 346 t produzidas e 346 t faturadas.
- **Conferido em 05/10:**
  - **Igual linha a linha:** a tabela Horas do banco é igual à da planilha em 18
    dos 22 meses, mesmo número de linhas, horas e metros.
  - **Agosto/2026:** TMR por máquina e perda (1.148 linhas, 45.116,10 kg) iguais
    à planilha, à tabela Apontamentos e ao BI.
  - **Setembro/2026:** a planilha foi atualizada antes de 30/09 ser todo
    apontado. Faltam nela 1.108 apontamentos (455,6 h), e o BI, que lê a
    planilha, também.
  - **Fevereiro a abril/2025:** o banco tem 4.053 linhas incluídas em lote em
    03/04/2025, quase todas de 0 h, que a planilha de 2025 não tem.
  - **Séries publicadas, tudo pelo banco:** horas e perda iguais às de antes
    em 22 de 22 meses, aderência em 12 de 12, apara apontada de jun/2025 a
    ago/2026 e m² de jan a set/2026 (outubro mais atual; 2025 passou a
    existir).
- **Ainda de planilha:** a apara confirmada (Sequenciamento dos fardos,
  Acumulado e Refugo Aparas, lançados à mão) e a aderência (ADERÊNCIA DIÁRIA
  do PCP: o banco só guarda a programação atual; com as fotos diárias de
  `banco.programacao_pcp`, ela poderá vir do banco).

## Execução automática

Tarefa "Gualapack Data Hub" no Agendador de Tarefas do Windows. Ela roda a
cada 10 minutos com o usuário logado, sem abrir janela. A cada rodada lê o
banco (só regrava o mês ou a foto que mudou) e copia as planilhas manuais que
mudaram; o resto só roda se algo mudou no banco, na pasta ou na configuração,
e ao menos uma vez por dia (o frescor depende da data de hoje). O registro
fica em `logs/hub-AAAA-MM.log`.

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
  do **BI Indicadores Produção** aplicadas ao banco:

  | Cartão | Regra (medida do BI) | De onde |
  |---|---|---|
  | TMR | produzindo ÷ horas sem FIM TURNO e sem INATIVIDADE | apontamentos (tabela Horas) |
  | Velocidade | metros ÷ horas produzindo ÷ 60 (VelMédia) | apontamentos (tabela Horas) |
  | Paradas | horas por código, fora PRODUZINDO | apontamentos (tabela Horas) |
  | Apara apontada | refugo ÷ (refugo + peso bruto das REBs) | apontamentos (BASE_PROD) |
  | Apara confirmada | "% JGR" da Conta Refugo: scrap JGR ÷ (volume JGR + scrap JGR) | Refugo Aparas (planilha); sem o 006, a conta do BI com o peso bruto da BASE_PROD |
  | Aderência | realizado ÷ planejado, km lineares (Ad. Plan Mensal) | Histórico Aderência Programação (planilha, aba PROGRAMAÇÃO) + apontamentos sem WIP e sem revisão (`sql/clean/210_plano.sql`, 006) |
  | Perda por motivo / máquina, OPs | kg de perda apontada (código 40) | apontamentos |
  | OEE (cartões das máquinas, 007) | qualidade × performance × disponibilidade. Qualidade = 100 − refugo da máquina ÷ (esse refugo + peso final das OPs que passaram por ela); performance = velocidade ÷ melhor mês, até 100; disponibilidade = TMR | apontamentos (BASE_PROD e tabela Horas; `sql/clean/230_qualidade_maquina.sql`) |
  | Apara por classificação | apontado por grupo de produto (Aparas_Geral v3) | BASE_PROD |
  | Produtividade | m² ÷ horas produzindo | apontamentos + largura da estrutura |

  A apara de referência é a **confirmada**, com meta de 12% (decisão do dono
  em 07/10/2026); a apontada fica como comparação, sem meta. Desde 08/10
  (006), o número da confirmada em cada mês é a coluna "% JGR" da Conta
  Refugo, como o time usa: scrap JGR ÷ (volume JGR + scrap JGR). A VOLUME JGR
  é o peso bruto das REBs até o último dia pesado (out/2026: 62.392 kg de
  01 a 06/10), então o mês em andamento não divide o fardo de ontem pela
  produção de hoje. Período de mais de um mês e o cartão "Apara confirmada
  {ano}" seguem o bloco ACUMULADO (YTD) da planilha: scrap total ÷ (volume
  total + scrap total), JGR + ORF (`v_hub_apara_ano`; conferido: YTD 2025 =
  13,46%, YTD 2026 = 14,28% em 08/10). Em jan–mar/2026 o % JGR é diferente da
  medida do BI ("% PerdaConfirm. TOTAL", que soma a ORF no scrap e usa o peso
  bruto do banco): a página Qualidade dos dados segue conferindo a medida do
  BI.

  A aderência (006) é a da página Ad. Plan Mensal do BI: conferida em
  set/2026, planejado e realizado iguais nas 13 máquinas (20.431 km
  planejados, 17.604 km realizados). A REVISORA 01 fica de fora (planejado
  sem realizado possível, e fora do gráfico do BI). No mês em andamento, o
  planejado é o do mês inteiro, como o BI, e a % compara com o planejado até
  hoje. Sem o 006, o painel segue com a conta antiga (produzido ÷ planejado da
  ADERÊNCIA DIÁRIA, o "% Realizado Prog" da página Ad. Plan Diária).
- **As telas que vêm direto do banco** (`sql/supabase/005_banco.sql`): fotos
  do estado atual que o painel lê inteiras (máquinas agora, fila de
  programação, WIP, carteira) e séries por dia somadas no período (entregas
  por classificação, setup programado x real, laudos do CQ, faturamento), mais
  a série mensal de carteira x produzido x faturado.

  Os cartões gerais (TMR, aderência, velocidade) são o total do período,
  como no BI, não a média das máquinas. A regra do TMR foi escolhida pelo
  dono em 25/09 (o Gráficos Tendência usa outra; segue conferido à parte).
  Em ago/2026: TMR geral 42,7%, R18 50,7%, apontado 11,49%, confirmado
  14,63%, aderência 76,0% (a conta antiga, % Realizado Prog), perda
  45.116 kg — iguais ao BI. Sem o 002 aplicado, o painel segue como era.
- **A linha do tempo** (006): os eventos de cada um dos últimos 14 dias de
  produção (das 06:00 às 06:00 do dia seguinte; o turno da noite ainda é do
  dia anterior no banco), um dia por publicação e só o dia que mudou. O
  evento que vem do dia anterior aparece nos dois dias, cortado na janela. O
  painel abre no último dia fechado e busca outro dia só quando ele é
  escolhido.
- **A qualidade do OEE** (007): para cada máquina, o refugo que ela apontou
  nas OPs que passaram por ela e o peso final dessas OPs (o peso bruto nas
  REBs; OP ainda não pesada fica de fora). Cada par máquina × OP entra uma
  vez, no último dia em que a máquina produziu a OP, então a soma de um
  período não conta a mesma OP duas vezes. Em set/2026: de 90,7% (REB 01) a
  99,6% (L03). A performance usa o melhor mês da máquina, e não a meta de
  m/h da `View_usr_Acompanhamento_Prod`, porque essa meta dava mais de 100%
  (R18 158%, HMC01 393%).
- **Página Qualidade dos dados** (`demo/qualidade.html`, ícone de prancheta
  no menu): placar por status, cada indicador mês a mês e recorte a recorte,
  o que corrigir nas planilhas, as fontes e os avisos.

Só sai do PC o que é agregado: horas e metros por máquina/dia/código, peso
bruto e refugo por OP/dia (com a descrição do produto), perda por
OP/dia/tipo, programado × produzido por OP/dia e planejado × realizado por
máquina/dia, kg e m² por máquina/dia, refugo e peso final das OPs por
máquina/dia (a qualidade do OEE), os eventos dos últimos 14 dias
(máquina, código, início, fim, OP), valores por mês e
recorte, o catálogo de indicadores, o estado de cada fonte (sem caminho de
arquivo) e os avisos (com os caminhos apagados). Das telas do banco: a
atividade e a OP de cada máquina agora, a fila por máquina, o WIP somado por
etapa, local, cliente e idade, os itens da carteira em aberto, e entregas,
setup, laudos e faturamento somados por dia. O cliente (nome da empresa)
vai onde a tela pede (WIP, carteira, fila, entregas); operador, analista,
vendedor, preço e observação nunca saem do banco. As séries vão um mês por
vez e só o mês que mudou; o Supabase confirma quantas linhas gravou, senão o
mês vai de novo.

Os cartões ficam tão atuais quanto o banco (a cada 10 min) e as planilhas
manuais da pasta compartilhada; os BIs são a conferência.

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
6. No **SQL Editor** → rodar `sql/supabase/003_conferencia.sql` (apara do
   período, séries mensais reais e refugo por máquina e motivo). Tem de
   mostrar `funcoes_ok = true`. Não precisa publicar de novo.

7. No **SQL Editor** → rodar `sql/supabase/004_classes.sql` (a classe
   oficial de cada código de apontamento, pra cor das paradas no painel).
   Só cria uma view de leitura. Não precisa publicar de novo.
8. No **SQL Editor** → rodar `sql/supabase/005_banco.sql` (as tabelas e a
   leitura das telas do banco: agora, fila, WIP, carteira, entregas, setup e
   laudos; já inclui a view do 7). Tem de mostrar `funcoes_ok = true`. Depois,
   aqui em `hub/`: `uv run hub publicar`. Sem o 005, o hub publica o resto
   normalmente e avisa o que ficou de fora.
9. No **SQL Editor** → rodar `sql/supabase/006_tempo_aderencia.sql` (linha do
   tempo por dia de produção, aderência do Ad. Plan Mensal e a apara
   confirmada do mês em andamento). Tem de mostrar `funcoes_ok = true`. A
   próxima rodada do hub publica o que faltava. Sem o 006, o hub publica o
   resto e avisa o que ficou de fora. Precisa da fonte
   `aderencia.programacao` no `config/fontes.local.yaml` (a Histórico
   Aderência Programação, aba PROGRAMAÇÃO, só as 4 colunas usadas).
10. No **SQL Editor** → rodar `sql/supabase/007_oee.sql` (a qualidade de cada
    máquina, para o OEE dos cartões, e o `hub_publicar` versão 5, em que os
    conjuntos por dia são uma lista: série nova = uma linha na lista). Tem de
    mostrar `funcoes_ok = true`. A próxima rodada do hub publica a série. Sem
    o 007, o hub publica o resto e avisa o que ficou de fora.

Feitos: 1 a 3 em 25/09, 4 a 6 em 30/09, o 8 (que já faz o 7) em 07/10, o 9
em 08/10.

### Conferência com o motor do BI (30/09)

O painel foi aberto de verdade (Supabase real, um mês por vez, out/25 a
set/26) e cada número comparado com o próprio modelo do BI Indicadores de
Produção, consultado pelo Power BI Desktop (mesmo motor que desenha os
visuais: filtros, relações e medidas DAX dele). Das 452 comparações, 421
bateram. As diferenças e o que foi feito:

- Cartões de apara (apontada, confirmada, diferença) mostravam sempre o
  último mês, em qualquer período; no BI seguem o período →
  `rpc_hub_apara_periodo` (003). Confirmado do mês em andamento passa a
  aparecer no gráfico, como no BI.
- Dez/2025: a planilha Base Aparas de 2025 tinha valores velhos da L04 → a
  perda usa o Base Aparas Genérico sempre que ele cobre a data.
- Set/2026: diferenças pequenas de horário de atualização (BI atualizado
  depois das planilhas), não de conta.
- Números desenhados sem dado: linhas de tendência dos cartões sorteadas,
  "TMR — últimos 12 meses" e refugo por motivo do detalhe da máquina, a tela
  WIP & Carteira e frases fixas do assistente → trocados por séries reais
  (`rpc_hub_mensal`, `rpc_hub_perda_maquina_motivo`) ou por "sem dados".

Bateram em todos os meses: TMR, velocidade, perda e aderência por máquina;
horas por parada; OPs com mais refugo; apara por classificação; séries do
gráfico Aparas GPK; produção mensal; totais de TMR, velocidade e aderência.
O BI não tem TMR de 2025 (a tabela MachineCard dele começa em 2026); o painel
tem, pelo Machine Card de 2025.

Depois do 003 aplicado (30/09, tarde), a mesma conferência no Supabase real:
428 de 452 iguais. O resto:

- 13 casos de máquina sem programação no mês (Revisora 01, Coating 01 em
  mai–jun, R12 depois de julho): o BI mostra 0,00%, o painel deixa sem valor
  (regra do projeto: sem dado não é 0%). Mês inteiro sem programação (out/25,
  antes da base de aderência) mostra "Sem dados de programação no período".
- 3 casos de motivo de perda em branco: mesmo kg; o painel chama de "Sem
  motivo informado".
- 8 casos em set/26, mês em andamento, todos de horário: o BI foi atualizado
  às 09:53; a Refugo Aparas (confirmada) e a Aderência Semanal foram gravadas
  depois, e o BI lê a Perda Sistêmica direto do banco, então tem as perdas de
  hoje que a Base Aparas ainda não tinha. Até o dia anterior, perda igual.

Depois disso cada execução publica sozinha. `uv run hub publicar` também
serve pra reenviar tudo se o dado do Supabase se perder. Com
`publicacao.ativa: false` no `fontes.local.yaml` o hub só gera o relatório
local. Se a publicação falhar (sem rede, por exemplo), a execução continua,
o motivo vira aviso no relatório e a próxima tenta de novo.

## Configuração

| Arquivo | Vai pro git? | O quê |
|---|---|---|
| `config/fontes.local.yaml` | **Não** | Pasta de entrada, planilhas, abas, colunas obrigatórias, frescor. Modelo em `fontes.exemplo.yaml` |
| `config/sqlserver.local.yaml` | **Não** | Servidor e banco da leitura direta (usuário e senha ficam no Cofre do Windows) |
| `config/classificacao_apontamentos.csv` | Sim | Classe de cada código de apontamento (cópia da tabela-padrão) |
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

## Situação em 05/10/2026

- Tudo que o painel mostra sai do banco, menos a apara confirmada e a
  aderência (planilhas manuais do PCP).
- **26 fontes** catalogadas: as leituras do banco, as planilhas manuais e os
  dois BIs (conferência).
- **Validação:** 497 validados, 18 divergentes, 42 aguardando. As
  divergências têm causa conhecida: em setembro o BI leu uma planilha
  desatualizada (faltam nela 455,6 h); em fevereiro, o filtro Des_NumOrdem do
  próprio BI.
- **Telas novas:** agora no chão de fábrica, entregas no prazo, fila de
  programação, setup programado x real, WIP, carteira x produzido x faturado
  e laudos do CQ.

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

1. Aderência pelo banco: com algumas semanas de fotos diárias da
   programação do PCP (`historico/programacao_pcp_*.parquet`), reproduzir a
   ADERÊNCIA DIÁRIA sem a planilha.
2. As três planilhas manuais da apara confirmada: trocar por API ou agente
   (decisão pendente).
3. Lista de máquinas e grupos: é o que ainda vem do fluxo antigo (Google
   Drive).
4. Produtividade: o painel mostra m² ÷ hora de máquina. A do BI (m² ÷ hora
   trabalhada) depende da Folha de Ponto.
5. Tirar o backend do Supabase para um servidor da fábrica (decisão do dono,
   para depois).
6. Desligar o fluxo antigo (Google Drive + GitHub Actions) quando o dono
   confirmar que o painel pelo hub está certo.
