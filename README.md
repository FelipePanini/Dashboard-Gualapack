# Painel de Produção — Gualapack Jaguariúna

Painel web com os indicadores de produção da fábrica de Jaguariúna: o que
cada máquina está fazendo agora, TMR, aparas e refugo, produtividade, setup,
aderência ao plano, entregas no prazo, fila de programação, WIP, carteira e
laudos do CQ. Os números vêm direto do banco da fábrica (Metrics), só por
leitura, com as regras dos BIs de Produção, conferidas mês a mês.

**Painel:** https://felipepanini.github.io/Dashboard-Gualapack/demo/ (acesso
com login; cadastro só com chave de convite).

> **O data hub ([`hub/`](./hub/README.md))** lê o banco a cada 10 minutos,
> num PC da rede da fábrica, aplica as regras dos BIs, confere cada indicador
> contra a fonte oficial e publica o resultado no Supabase. A página
> **Qualidade dos dados** (`demo/qualidade.html`) mostra cada número, a
> fonte, o status e as divergências.

---

## Como o dado chega na tela

```
SQL Server da fábrica (banco Metrics)      planilhas de lançamento manual (PCP)
        │  só leitura (SELECT)                      │  fardos, acumulado, refugo aparas
        │                                           │  e histórico da programação (aderência)
        ▼                                           ▼
Data hub (hub/) — Python + DuckDB num PC da rede da fábrica, a cada 10 min
        │  limpa, aplica as regras dos BIs, confere e publica só o resumo
        ▼
Supabase (Postgres) — schema trusted + views e funções de leitura
        │
        ▼
demo/index.html — o painel (GitHub Pages)
```

O hub entra no banco com um usuário só de leitura, guardado no Cofre de
Credenciais do Windows, e o código recusa qualquer comando que não seja uma
consulta (`hub/src/hub/sqlserver.py`). Nada é gravado no banco da fábrica.

O fluxo anterior (planilhas no Drive → GitHub Actions → tabelas brutas no
Supabase, em `backend/`) continua no repositório. O painel só volta a ele se
as funções do hub não existirem no Supabase.

---

## Linha de raciocínio

Por que o projeto é do jeito que é. Cada item foi uma escolha entre
alternativas, e o motivo continua valendo enquanto a situação não mudar.

1. **A fonte é o banco da fábrica, lido direto e só por leitura.** Até
   outubro/2026 a porta de entrada eram as planilhas que o time atualiza no
   Excel, porque o SQL Server só é acessível de dentro da rede e não havia
   acesso. Com o usuário de leitura liberado, o hub lê as mesmas views que as
   planilhas e os BIs leem: os números batem com o BI e não dependem de
   alguém atualizar uma planilha. Ficam em planilha só os lançamentos que não
   existem no banco: sequenciamento dos fardos, acumulado e refugo aparas (a
   apara confirmada na balança) e o planejado da aderência (a Histórico
   Aderência Programação do PCP: o banco guarda só a programação atual; o hub
   passou a guardar uma foto por dia dela).

2. **O peso fica no PC, o Supabase recebe o resumo.** O hub guarda as
   extrações em arquivos locais e calcula tudo num DuckDB. Pro Supabase vão
   só séries por dia e máquina e fotos pequenas do estado atual (máquinas
   agora, fila, WIP, carteira). Cada mês leva uma assinatura, e só o que mudou
   é reenviado.

3. **O navegador nunca lê tabela bruta.** A tabela de apontamentos tem
   centenas de milhares de linhas. Funções no banco somam por máquina, motivo
   ou mês e devolvem dezenas de linhas. O calendário do topo passa o período
   escolhido como parâmetro pra essas funções.

4. **Login por convite, dados protegidos no banco.** A chave pública do
   Supabase fica no site, mas só lê o que as regras de acesso (RLS) permitem,
   e só pra quem está logado. O cadastro exige uma chave de convite, validada
   no servidor.

5. **Resumo, não eventos, no Supabase.** O plano gratuito tem 500 MB, e
   vários anos de eventos de máquina estouraram esse limite uma vez. Por isso
   o Supabase recebe séries somadas por dia, e só os últimos 14 dias de
   produção vão evento a evento (linha do tempo), um dia por vez.

6. **Cada mês substitui o que gravou antes, nunca por vazio.** O hub relê os
   meses recentes a cada execução e só regrava um mês quando o dado muda. Mês
   que volta vazio do banco não apaga o que já existia: vira aviso. Essa
   proteção vem de 18/09, quando uma aba pulada zerou as horas do ano.

7. **Uma fonte por indicador, e divergência vira pergunta.** Quando a
   planilha e o painel discordam, os dois números aparecem lado a lado com a
   causa provável. Quem decide qual vale é o dono do indicador, não o código.

8. **Nada inventado com cara de dado real.** A regra é mostrar vazio quando o
   dado não existe. Parte do banco que ainda não foi publicada, ou que falhou
   ao carregar, aparece como "Sem dados" no próprio painel, nunca como zero;
   o resto do painel segue normal.

---

## Onde está cada coisa

| Caminho | O que é |
|---|---|
| [`demo/`](./demo/) | O site: `index.html` (painel), `login.html`, `admin.html` (convites), `qualidade.html` (validação publicada pelo hub), `upload.html` (upload manual, legado), `assets/ui.js` (menus e dicas no tema do painel), `assets/logo3d.js` (o G em vidro 3D da tela de entrada). O nome `demo` ficou porque é o endereço já publicado. |
| [`backend/sql/`](./backend/sql/) | Estrutura do banco: login e convites, tabelas dos dados, funções e views (as do fluxo anterior). |
| [`backend/sync-drive/`](./backend/sync-drive/) | Fluxo anterior: a carga diária das planilhas do Drive (etapas 1 e 2). |
| [`backend/functions/`](./backend/functions/) | Funções do Supabase: cadastro com convite e upload manual. A `assistente` (chat com o Claude, API paga) está sem uso desde 07/10/2026. |
| [`.github/workflows/`](./.github/workflows/) | Fluxo anterior: `build-database-central.yml` (etapa 1) e `sync-drive.yml` (etapa 2). |
| [`docs/guias/`](./docs/guias/) | Passo a passo: configurar o Supabase, a carga automática, o upload manual. |
| [`docs/mapeamento/`](./docs/mapeamento/) | Levantamentos: inventário das 220 abas, redundâncias, origem de cada número, validação contra as planilhas. |
| [`docs/historico/`](./docs/historico/) | Retrato do projeto em 14/09/2026, com as decisões e descartes até ali. |
| [`tools/`](./tools/) | Script local pra cortar uma planilha grande numa aba só (apoio ao upload manual). |
| [`hub/`](./hub/) | Data hub: lê o banco da fábrica (só leitura) e as planilhas manuais, aplica as regras dos BIs, confere cada indicador contra a fonte oficial e publica no Supabase (schema `trusted`; SQL em `hub/sql/supabase/`). Python + DuckDB, roda num PC da rede. |

---

## De onde vem cada número

| No painel | No banco (Metrics) ou planilha | Regra |
|---|---|---|
| Agora: o que cada máquina está fazendo | `View_usr_apontamentos_999999` (evento em andamento) + `CTREntradasMaquina` (OP aberta) | classe pela classificação oficial; velocidade real = metros ÷ horas produzindo da OP; programada e término previsto da OP |
| TMR, horas, paradas | `View_usr_apontamentos_999999` | produzindo ÷ horas sem FIM TURNO e INATIVIDADE (BI Indicadores Produção) |
| Linha do tempo | idem, evento a evento | um dia de produção por vez, das 06:00 às 06:00 do dia seguinte (o turno da noite ainda é do dia anterior); abre no último dia fechado, com os 7 dias mais recentes no seletor |
| Perda por motivo e por máquina, OPs com mais refugo | idem, código 40 | kg apontados |
| Apara apontada (comparação, sem meta), produção em kg | idem, consulta BASE_PROD | refugo ÷ (refugo + peso bruto das rebobinadeiras) |
| Apara confirmada (a de referência; meta 12%) | Refugo Aparas (aba Conta Refugo) | um mês: a coluna "% JGR" da planilha, scrap JGR ÷ (volume JGR + scrap JGR). Mais de um mês e o cartão do ano: o bloco ACUMULADO (YTD) da planilha, scrap total ÷ (volume total + scrap total), com a ORF de jan–mar/2026 (YTD 2025 = 13,46%, YTD 2026 = 14,28% em 08/10) |
| Produtividade (m²/h) e velocidade | apontamentos, código 20, + `EstrProcessos` (largura) | m² = metros × largura; ÷ horas produzindo |
| Aderência ao plano | planilha Histórico Aderência Programação (PCP, aba PROGRAMAÇÃO) + apontamentos | como a página Ad. Plan Mensal do BI: planejado = QtdPlanejada pelo dia de início planejado; realizado = QtdProduzida sem WIP e sem revisão (km = metros ÷ 1000). No mês em andamento, o planejado é o do mês inteiro e a % compara com o planejado até hoje |
| Entregas no prazo | `View_usr_Entregas_Desempenho` (a consulta da Aderência Semanal) | Ótimo: faturado até a data do cliente; Bom: até a do PCP; Regular, Ruim e Péssimo: até 5, 10 e mais de 10 dias depois da do PCP |
| Fila de programação | `view_usr_ProgramacaoPlanner` | OPs alocadas e não finalizadas, na ordem do PCP |
| Setup programado x real | `View_usr_Acompanhamento_Prod` | minutos programados x reais por OP |
| WIP | `view_usr_pallet_wip_disponiveis` | pallets, metros e kg por etapa, cliente e idade |
| Carteira | `View_usr_ListaPedidosVenda` + estrutura do produto | um item por linha; kg = a quantidade em KG, ou m² × gramatura da estrutura ÷ 1000 |
| Faturado | `view_usr_notas_saida_entrada_custo` | notas de produto acabado; kg = m² × gramatura ÷ 1000, como o BI |
| Laudos do CQ | `view_usr_LaudoAnalise` | por resultado |
| Classe de cada código de apontamento | `hub/config/classificacao_apontamentos.csv` | cópia da tabela-padrão Classificação_Apontamentos |
| Lista de máquinas e grupos | tabela `maquinas` do Supabase | Machine Card → DIM_EQTOS & GRUPO EQTO |

Regras e conferência número a número: [`hub/README.md`](./hub/README.md) e a
página Qualidade dos dados.

---

## Rotina

1. **O hub roda sozinho a cada 10 minutos** (tarefa "Gualapack Data Hub" no
   PC da fábrica): lê o banco, copia as planilhas manuais que mudaram na pasta
   compartilhada e publica o que mudou.
2. **As planilhas manuais** (sequenciamento dos fardos, acumulado, refugo
   aparas e histórico da programação) continuam sendo atualizadas pelo time; o hub
   pega a versão nova na rodada seguinte.
3. **Conferir:** o selo no topo do painel mostra até quando vai o dado e fica
   âmbar quando passa de 2 dias; a tela Agora mostra a hora do apontamento
   mais novo; a página Qualidade dos dados mostra cada fonte, divergência e
   aviso.

---

## Regras do projeto

- **Segredos só em GitHub Secrets.** Senha, token, chave de API e credencial
  do Google ou do Supabase nunca entram no código. A chave pública do
  Supabase em `demo/supabase-config.js` é pública por natureza.
- **Repositório público.** Nome de servidor interno, IP, caminho de rede e
  dado pessoal de colega não entram em arquivo nenhum.
- **Banco da fábrica só por leitura.** Usuário de leitura, conexão
  `ApplicationIntent=ReadOnly` e uma trava no código que recusa tudo que não
  for consulta. Nenhuma tabela, view ou dado do Metrics é criado ou alterado.
- **Os arquivos originais do Drive e da pasta compartilhada não são
  alterados.** O hub só lê (e copia o que mudou pra pasta de entrada dele).
- **Nada de dado fictício com cara de real.** Melhor mostrar "sem dados" do
  que 0% ou um número inventado.
- **O visual do painel não muda** sem pedido explícito. Mudança de dado não
  mexe em layout, cor nem tipografia.
- **Mudança de estrutura no Supabase** (tabela, função, view) é entregue como
  SQL em `hub/sql/supabase/`. Rodar no Supabase é decisão do dono do projeto.
- **Divergência entre fontes** é mostrada com as duas versões e a causa
  provável. Nenhum valor é escolhido em silêncio.

### Interface do painel (revisão de 05/10)

Revisada pelas diretrizes de design da Apple (skill `apple-design`). O que
vale daqui pra frente em `demo/index.html`:

- **Contraste mínimo 4,5:1** nos textos, nos dois temas. As cores são tokens
  no topo do CSS (`--text-muted`, `--good`, `--warning`...): mudar uma cor é
  mudar o token, conferindo o contraste.
- **Uma cor, um significado.** Verde/âmbar/vermelho são status (vermelho só
  pra alerta). Paradas usam a cor da classificação oficial do código
  (`--cls-*`), igual no Gantt, nas horas de parada e no Pareto.
- **Vidro (blur) só na camada funcional**: barra do topo, barra de abas do
  celular, gaveta de detalhe, chat e seletor de período. Painéis e cartões
  são opacos. Com "Reduzir transparência" ou "Aumentar contraste" no sistema,
  o vidro vira superfície opaca.
- **Gráficos desenhados na largura real do painel** (`montarGrafico`): 1
  unidade = 1 px, texto de 11 px pra cima, redesenho ao mudar de largura.
  Rótulo que não cabe ganha reticências, com o nome inteiro no `<title>`.
- **Menus e dicas do painel, nunca os do navegador** (`demo/assets/ui.js`,
  em index, qualidade e admin, desde 08/10):
  - Todo `<select>` abre o menu pop-up do painel, com vidro, marca ✓ na
    opção atual, nome e detalhe alinhados e separador entre grupos (opção
    com `data-separador`). Funciona com mouse e teclado (Enter, setas, Esc,
    digitar o começo do nome).
  - No toque fica o seletor do sistema.
  - Todo `title` (e `<title>` de SVG) vira a dica do painel, que aparece
    depois de 0,5 s. Na barra lateral, a dica fica à direita do botão.
  - Basta usar `<select>` e `title` normais.
- **Tela de entrada com o G da marca em vidro 3D** (`demo/assets/logo3d.js`,
  desde 08/10):
  - É o G do ícone e da barra lateral (Playfair Display itálico, peso 700),
    extrudado em vidro com three.js (CDN jsdelivr) sobre o fundo azul da
    página.
  - Fica na camada de conteúdo: o cartão de vidro do login passa por cima e
    desfoca a parte de trás. Na tela larga ele fica à esquerda do cartão; no
    celular, acima.
  - Movimento lento: giro, flutuação e um leve acompanhar do mouse. Para com a
    aba oculta, fica parado com "Reduzir movimento" e também em máquina lenta
    (média acima de 45 ms por quadro).
  - Sem WebGL ou sem o three.js, ficam as manchas de CSS de antes.
- **Seta e cor no cartão só com comparação de verdade**: contra a meta
  (apara confirmada, 12%) ou contra o mês anterior da série real do hub. O
  resto é texto neutro. A apara apontada (por OP, por família de produto) não
  tem meta e aparece sem cor de status.
- **Máquina sem apontamento no período** fica neutra ("Sem apontamento",
  "—"), não "Crítico 0%". As faixas do TMR (75% e 62%) continuam as mesmas
  até a meta ser definida.
- **Movimento**: curto (até ~0,6 s), com curva de mola, nunca bloqueia o uso
  e some com "Reduzir movimento". Cada tela anima só na primeira vez que
  aparece; trocar de aba de novo não repete.
- **Celular** (até 768 px): abas embaixo, detalhe da máquina como folha que
  sobe de baixo (arrasta pra fechar), nenhuma rolagem lateral.
- **Avatar abre o cartão da conta** (barra lateral no computador, topo no
  celular): nome, e-mail, perfil, área, desde quando tem acesso e último
  login, só com o que `profiles` e o login guardam. No celular o "Sair" fica
  dentro desse cartão.
- **Agora no chão de fábrica** busca o dado de novo a cada 5 minutos, e o
  "há quanto tempo" anda a cada minuto. Com o dado parado há mais de 30 min,
  a legenda fica âmbar e os tempos param no último apontamento lido.
- **Tabelas longas** mostram as primeiras linhas e "Mostrar todas". WIP e
  carteira exportam CSV (";" e vírgula decimal: abre direto no Excel).
- **Leitura em páginas:** fila, WIP e carteira vêm inteiras mesmo acima do
  limite de 1.000 linhas por pedido do Supabase.
- **Assistente sem IA** (botão redondo): responde na hora com os números que o
  painel já carregou (apara, TMR, uma máquina, o que está parado agora,
  entregas, fila, setup, WIP, carteira, laudos e um mês da série). Entende a
  pergunta por palavras-chave; quando não entende, sugere o que sabe
  responder. Nada sai da página e nada é cobrado (decisão de 07/10/2026: sem
  API paga de IA).

---

## Pendências e limitações conhecidas

- **SQL do Supabase:** 6 arquivos, de `001` a `006_tempo_aderencia.sql`;
  num Supabase novo, rodar em ordem (`hub/README.md`). Sem o 005, as telas do
  banco mostram "Sem dados". Sem o 006, a linha do tempo mostra só o dia mais
  recente e a aderência fica na conta antiga (ADERÊNCIA DIÁRIA). O resto do
  painel funciona igual.
- **Planejado da aderência ainda de planilha.** O banco guarda só a
  programação atual. Desde 05/10/2026 o hub guarda uma foto por dia da
  programação do PCP; com algumas semanas de fotos dá pra calcular o
  planejado sem a planilha.
- **% Aderência do BI não reproduzida no mês em andamento.** O BI divide pelo
  "Planejado teórico" (tabela Disponibilidade, não lida pelo hub). O painel
  compara com o planejado até hoje, pelo dia de início planejado, e diz isso
  no cartão. Meses fechados: planejado e realizado iguais ao BI (set/2026,
  13 máquinas).
- **Três planilhas manuais** (sequenciamento dos fardos, acumulado e refugo
  aparas) seguem como fonte da apara confirmada. Trocar por API ou agente:
  decisão pendente.
- **Peso dos produtos em m² no cadastro.** O `PesoEMKG` da maioria dos
  produtos vendidos em m² é 1,0 ou 0, então o "TotalKG" da lista de pedidos
  sai em m², não em kg. O hub não usa esse campo: pesa a carteira pela
  gramatura da estrutura, a mesma das notas. Itens em milheiro, metro ou cm²
  ficam sem peso (o cartão diz quantos).
- **Códigos fora da classificação oficial:** 132 (Acerto de cores - Cromia) e
  133 (Problema de matéria prima), 20 h e 18 h em 2026, aparecem como "Sem
  classificação". Pra classificar, incluir no
  `hub/config/classificacao_apontamentos.csv` (e na planilha oficial).
- **Faixas do TMR** (Dentro da meta ≥ 75%, Atenção ≥ 62%, Crítico abaixo)
  são as de antes e deixam quase toda máquina em "Crítico". Aguardando a
  meta de TMR por máquina ou por etapa.
- **TMR: vale a regra do BI** (decisão de 25/09): produzindo ÷ horas sem FIM
  TURNO e INATIVIDADE.
- **Falha ao carregar.** O painel tenta de novo uma vez; se falhar outra
  vez, mostra "Não consegui carregar os dados" e nenhum número. Os valores
  de referência só aparecem na pré-visualização local, sem Supabase.
- **Produtividade usa horas de máquina.** O Power BI divide por horas
  trabalhadas da Folha de Ponto, que não está no banco nem no Drive. O
  rótulo do card diz isso.
- **Apara por classificação** mistura populações diferentes (o refugo vem de
  mais máquinas que o peso bruto). Aguardando uma fonte com classificação e
  peso na mesma linha.
- **Upload manual desatualizado.** A tela `upload.html` e a função `ingest`
  são do fluxo anterior. Atualizar ou aposentar: decisão pendente.
- **Oito views no banco sem uso pelo painel.** A lista está no topo de
  `backend/sql/schema_views.sql`. Podem ser removidas quando convier.
- **Histórico do git.** Commits antigos ainda contêm o nome do servidor
  interno e caminhos do OneDrive, que já saíram dos arquivos atuais. Como o
  repositório é público, apagar esse histórico exigiria reescrevê-lo.

---

## Documentação

- [Configurar o Supabase](./docs/guias/configurar-supabase.md) — banco, login e convites.
- [Carga automática via Google Drive](./docs/guias/carga-automatica-drive.md) — configuração, rotina e erros.
- [Upload manual (legado)](./docs/guias/upload-manual.md)
- [Mapeamento de dados](./docs/mapeamento/) — inventário, origem de cada número, validação.
- [Contexto histórico (14/09/2026)](./docs/historico/CONTEXTO_PROJETO_2026-09.md)
- [backend/](./backend/README.md) — o que roda fora do navegador e como testar.
