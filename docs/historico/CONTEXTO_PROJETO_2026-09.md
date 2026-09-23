# Contexto do projeto — Painel de Produção Gualapack

> **Retrato histórico de 2026-09-14.** Várias coisas mudaram depois (a
> produtividade m²/h foi ligada, o TMR passou a usar o cadastro de
> classificação, o filtro de datas virou calendário, a carga passou a rodar
> sozinha todo dia). O estado atual está no [README da raiz](../../README.md).
> Nomes de servidor, IPs e caminhos pessoais foram omitidos em 2026-09-23.
>
> Resumo gerado em 2026-09-14 pra alimentar outra sessão de IA (ou outro
> assistente) com o histórico completo até aqui, incluindo decisões,
> descartes e o porquê de cada um. Escrito pra quem NÃO participou da
> conversa original — nada de "como discutimos antes" sem explicar o quê.

---

## 1. O que é o projeto

Painel web (`felipepanini.github.io/Dashboard-Gualapack`) que mostra
indicadores de produção de uma fábrica (Gualapack, unidade Jaguariúna):
TMR (tempo de máquina rodando), apara/refugo, produtividade, aderência
ao plano, Gantt de produção, etc. Front-end estático (`demo/index.html`),
autenticação e dados vêm do **Supabase** (Postgres + Auth).

Repositório: `FelipePanini/Dashboard-Gualapack` (GitHub).
Branch de trabalho atual: **`claude/production-management-dashboard-htbojr`**
(a `main` só recebe merges e, esporadicamente, ferramentas temporárias —
ver seção 7).

## 2. Arquitetura de dados (como o dado chega no painel)

```
Planilhas reais (Excel, com Power Query ligado no SQL Server e no OneDrive
da empresa) — ficam numa pasta do GOOGLE DRIVE PESSOAL do usuário
        │  alguém atualiza o Excel (Atualizar Tudo) e sobe/sincroniza pro Drive
        ▼
backend/sync-drive/build-database-central.js — lê os arquivos originais
da pasta, normaliza, escreve um arquivo único: DATABASE_GUALAPACK.xlsx
(de volta na mesma pasta do Drive)
        │
        ▼
backend/sync-drive/sync.js — lê SÓ o DATABASE_GUALAPACK.xlsx, decide
INSERT/upsert/troca-por-arquivo, grava no Supabase
        │
        ▼
Supabase (tabelas brutas + views agregadas, RLS ligado)
        │
        ▼
demo/index.html — lê as views, desenha os gráficos
```

Os dois scripts (`build-database-central.js` e `sync.js`) rodam via
**GitHub Actions** (`ubuntu-latest`, nuvem — não precisam de VPN porque
só falam com Google Drive e Supabase, ambos públicos):
- `.github/workflows/build-database-central.yml` — manual por enquanto
  (`workflow_dispatch`), roda ~11 min.
- `.github/workflows/sync-drive.yml` — agendado (`cron: "0 6 * * *"`,
  6h UTC = 3h Brasília) + manual.

**Por que essa arquitetura em duas etapas** (originais → arquivo central
→ Supabase) em vez de ler os originais direto: decidido numa fase
anterior da conversa pra separar "leitura pesada de arquivo grande" (só
no build) de "carga incremental no banco" (todo dia, arquivo pequeno).

### Upload manual (plano B / fluxo real do dia a dia pra quem não tem
o sync automático configurado)

`demo/upload.html` — um admin arrasta a planilha (ou uma aba cortada)
direto no painel; chama a Edge Function `ingest` do Supabase. Serve como
caminho alternativo, mantido em paralelo ao `sync-drive` (os dois têm
que ficar sincronizados nas mesmas regras de detecção de tabela/aba —
ver `TABLES` em `upload.html` espelhando `TABLE_DEFS` em `lib.js`).

## 3. Restrições e regras do usuário (val­idas o tempo todo, não só numa fase)

Citadas quase literalmente porque são regras de trabalho, não sugestões:

- **Segurança**: "Nunca colocar diretamente no código: senha; token; API
  Key; credencial do Google; credencial do Supabase. Utilizar: GitHub
  Secrets + variáveis de ambiente."
- **Não mexer nos arquivos originais**: "NÃO apagar arquivos. NÃO excluir
  abas. NÃO substituir bases. NÃO renomear arquivos originais sem
  autorização. NÃO alterar fórmulas ou estrutura operacional sem
  necessidade." / "Não altere arquivos do Google Drive sem minha
  aprovação."
- **Não inventar dado**: "Nunca mostrar dado fictício." / "É preferível
  mostrar 'Sem dados' do que 0% ou qualquer número inventado." / "NÃO
  criar dados fictícias pra preencher espaços visuais."
- **Visual do painel é intocável** nesta fase: "Não alterar o visual"
  (sem mudar layout/cores/tipografia) — só trocar a fonte dos dados por
  trás.
- **Fonte única por indicador.** Quando duas fontes divergem: "NÃO
  escolha silenciosamente um valor. Mostre: FONTE A, FONTE B,
  DIFERENÇA, POSSÍVEL CAUSA, FONTE RECOMENDADA" — e deixe o usuário
  decidir.
- **A partir de 2026-09-14**: eu (a IA) **não aplico mais nenhuma
  alteração de schema direto no Supabase** — só entrego o SQL, o usuário
  decide quando/como rodar. (Antes dessa data eu tinha rodado uma
  migração direto — ver seção 9.)
- **GitHub**: nunca pushar na `main` sem necessidade concreta — só pra
  ferramentas temporárias que o GitHub *exige* estar na branch padrão pra
  disparar (`workflow_dispatch`/`schedule` só funcionam a partir da
  default branch). Nesses casos: sobe só o arquivo necessário, roda, e
  remove de volta assim que não precisa mais.

## 4. Cronologia das fases (o que foi decidido, em ordem)

### Fase 0 — Fase 1 original (herdada de sessão anterior)
Ligar `refugo_producao` e `producao_kg` no painel — já estava em
andamento quando esta sessão retomou.

### Fase 1 — Arquitetura DATABASE_GUALAPACK.xlsx
Especificação longa do usuário pedindo um arquivo central de
consolidação. Regra explícita: **"Não utilizar RAG. Não utilizar
documentos. Não utilizar embeddings. Não utilizar banco vetorial.
Trabalharemos somente com dados estruturados e numéricos."** e **"O
Dashboard já existe. Não devemos reconstruir o Dashboard."**

Resultado: a arquitetura da seção 2 (build-database-central.js + sync.js
cortado pra ler só o central).

Obstáculo técnico resolvido: a conta de serviço do Google não tem cota
de armazenamento fora de Shared Drives — não conseguia CRIAR o arquivo
central, só ATUALIZAR um já existente. Solução: um arquivo placeholder
criado manualmente pelo usuário (dono humano), a conta de serviço só
atualiza o conteúdo dele.

### Fase 2 — Mapeamento completo ("MAPEAR TUDO PRIMEIRO, DECIDIR DEPOIS")
Especificação de 20 seções pedindo inventário exaustivo de TODAS as
bases lógicas em TODAS as planilhas (não só as abas óbvias já em uso),
preservando origem (`arquivo_origem`, `aba_origem`, `origem`,
`data_importacao`), classificando cada uma (PRINCIPAL / COMPLEMENTAR /
REDUNDANTE / LEGADA / AUXILIAR / INCERTA).

Regra: **"NÃO OTIMIZE ANTES DE ENTENDER. NÃO DESCARTE ANTES DE
COMPARAR."**

Entregáveis (todos em `docs/mapeamento/`):
- `INVENTARIO_BASES.md`
- `RELATORIO_REDUNDANCIAS.md`
- `MAPA_ORIGEM_DADOS.md`
- `RELATORIO_CAMPOS.md`
- `RELATORIO_BASES_CANDIDATAS_A_DESCONTINUACAO.md`
- (depois) `MAPA_DASHBOARD_DADOS.md`

Achados principais:
- 220 abas / ~3,5 milhões de linhas inspecionadas no total.
- 29 bases lógicas catalogadas em `backend/sync-drive/bases-catalog.js`
  (algumas ainda só inventário, não ligadas ao Supabase).
- A maior redundância: o "evento de máquina" (1 linha = 1 apontamento)
  aparece em 8 lugares diferentes, em 4 arquivos.

### Fase 3 — DASHBOARD-DATA FITTING
Pergunta: "Qual dado alimenta cada número, KPI, gráfico, tabela e
componente do Dashboard?" → `MAPA_DASHBOARD_DADOS.md`. Regra: "Antes de
modificar tabelas, views ou componentes, apresente os principais
problemas encontrados e a ordem recomendada de correção."

### Fase 4 — INTEGRAÇÃO E CORREÇÃO (a fase em andamento até agora)
Ordem obrigatória combinada com o usuário:
- **FASE 1**: Apara apontada, duplicação de fardos, escala do gráfico, TMR
- **FASE 2**: Aderência, Gantt
- **FASE 3**: Produtividade, Velocidade, Metas
- **FASE 4**: Sparklines, filtros
- **FASE 5**: WIP/Carteira

## 5. O que já foi corrigido e validado (FASE 1 — completa)

Documentado em detalhe em `docs/mapeamento/VALIDACAO_DASHBOARD.md`
(formato: valor antes → valor depois, sempre validado contra o arquivo
original).

1. **Apara apontada mostrando 0%** — causa: a série ia até dez/2026
   (linhas futuras zeradas na planilha) e o painel lia o último item da
   série, não o último COM dado. Corrigido em dois pontos: a view
   `v_fardos_mensal` corta data futura e mês sem volume; o painel lê o
   último mês com dado de verdade. Resultado: 6,58% (ago/2026), série
   completa validada mês a mês.

2. **Duplicação de fardos** — `"Sequenciamento Acumulado 2026.xlsx"`
   repetia jan–jun/2026 dos arquivos mensais (confirmado: mesmo
   intervalo, contagens quase idênticas). Cada fardo contava 2×. Corrigido
   excluindo esse arquivo específico da detecção (`fileExclude` em
   `TABLE_DEFS`). **Correção de uma conclusão minha anterior**: eu tinha
   dito que isso inflava a apara de ~7% pra ~25%; na verdade numerador e
   denominador dobravam junto, o percentual não mudava — o que dobrava
   era o volume em kg, que o painel nem mostra. Registrei essa correção
   explicitamente no doc e no commit.

3. **Escala fixa do gráfico "Aparas GPK"** (3–9%) com dado real indo de
   6,6% a 26,3% — maior parte fora do eixo. Corrigido pra escala
   automática, ignorando meses sem dado no cálculo do range. Gráfico
   agora **quebra a linha** (não desce a zero) nos buracos entre séries
   com períodos diferentes, e o tooltip mostra "sem dados".

4. **TMR com 11 de 16 máquinas em 0%** — a tabela `apontamentos` vinha
   da aba **"Base Máquina_Embalagem"**, que só cobre as 5 rebobinadeiras
   (REB 01/04/05/09/10). Descoberta e trocada pra aba **"Base
   Apontamento"**, do mesmo arquivo (`Indicadores Diário - AAAA.xlsx`),
   que cobre as 16 máquinas reais e já traz a classificação oficial de
   disponibilidade (`CLASSIFICAÇÃO DISP.`). Decisão do usuário, sem
   ambiguidade: **"TMR iremos usar apenas da Base Apontamento, a outra é
   máquina de embalagem, nem vamos perder tempo com ela."**

   Dois bugs sérios apareceram e foram corrigidos durante essa troca
   (detalhes na seção 6) — vale saber que a troca de fonte **por si só
   não bastou**, quase saiu quebrada duas vezes.

## 6. Bugs reais encontrados e corrigidos (não são só "features")

1. **`Maximum call stack size exceeded`** ao gravar a Base Apontamento
   de 2026 (219.622 linhas). Causa: `bucket.rows.push(...rows.map(...))`
   — o spread passa cada linha como ARGUMENTO da chamada, e o V8 limita
   isso a ~125 mil. A aba antiga (Máquina_Embalagem) tinha 97 mil linhas
   e passava raspando; a nova excedeu. **Teria zerado a tabela em
   silêncio** se não tivesse sido pego. Corrigido trocando por um laço
   `for...of` com `.push()` simples.

2. **Timeout ao ler `Indicadores Diário - 2025.xlsx`** (87,8 MB,
   379.792 linhas) — não terminava em 18-42 min. Causa raiz real: o
   build fazia uma `XLSX.read()` por TABELA em vez de uma por arquivo —
   cada `XLSX.read` descompacta o zip inteiro, então um arquivo que
   alimenta 2 tabelas era descompactado 2×. Corrigido pra uma leitura
   por arquivo. Mesmo assim a aba de 2025 continuou grande demais;
   solução final: uma **sondagem barata** (`sheetRows: 1` mais
   `!fullref` pra pegar o tamanho real sem materializar tudo) que PULA
   e REGISTRA no `DB_CONTROLE` qualquer aba acima de 250.000 linhas, em
   vez de travar o job inteiro.

3. **Linhas órfãs never cleaned up** — bug estrutural no padrão
   "troca-por-arquivo" (`REPLACE_BY_SOURCE`) usado em 6 tabelas de
   evento. A lógica só apaga o que um arquivo gravou antes SE esse
   arquivo aparece nas linhas desta rodada. Quando um arquivo passa a
   contribuir ZERO linhas (aba pulada por tamanho, tudo filtrado pela
   retenção), ele nunca mais aparece, e o que gravou antes fica pra
   sempre. Foi exatamente o que aconteceu na troca do TMR: **46.084
   linhas antigas** (da aba Máquina_Embalagem, já abandonada) continuaram
   em `apontamentos`, contaminando o período set/2025–jan/2026 com fonte
   misturada — bug descoberto só depois de eu MESMO conferir os números
   no banco (`select count(*)... group by _source_file`), não avisado
   pelo usuário. Corrigido comparando com a listagem real da pasta do
   Drive: todo arquivo que devia alimentar a tabela mas não apareceu
   nesta rodada tem suas linhas antigas removidas antes do resto do
   processamento.

4. **Parser de Power Query decodificando errado** (ferramenta temporária,
   ver seção 7) — os `customXml/itemN.xml` do Excel vêm em **UTF-16LE
   com BOM**, decodificados como UTF-8 davam "mojibake" e o código caía
   silenciosamente no ramo errado do parser (tratando o BOM+"<?xml" como
   se fosse o cabeçalho binário do DataMashup). Corrigido detectando o
   BOM antes de decodificar.

## 7. Mapeamento das origens reais via Power Query (FEITO — resultado, não repetir)

Técnica usada: um `.xlsx` é um zip; a definição da consulta Power Query
(o que aparece em "Etapas Aplicadas" no Editor) fica numa parte interna
chamada `DataMashup` — código M em texto puro. Extraído via ferramenta
temporária (`extract-power-query.js`, rodada e depois removida da
`main`, como manda a regra da seção 3). **Não precisa repetir essa
extração** — o resultado já está consolidado abaixo.

### Servidor SQL Server único

Servidor SQL Server interno da Gualapack (nome de rede e IP omitidos deste
repositório público — ficam com a TI). Banco: `Metrics`.
**Só alcançável de dentro da rede/VPN da Gualapack** — não é resolvível
da internet pública, então GitHub Actions normal (nuvem) não alcança.

Views/tabelas usadas nas consultas mapeadas:
| Objeto | Uso |
|---|---|
| `dbo.View_usr_apontamentos_999999` | View principal — todo evento de máquina (hora, produção, refugo). Alimenta quase tudo. |
| `dbo.View_usr_EngenhariaXPasso` | Engenharia por OP (cliente etc.) |
| `dbo.view_usr_engenharia` | De-para código PA ↔ código de engenharia |
| `dbo.EstrProcessos` | Largura real por estrutura (usada no cálculo de m²) |
| `dbo.OrdensProducao` + `OrdItensCusto` + `OrdAtividades` | Dados de OP, cor, custo |
| `View_usr_programacao_teruel` | Programação futura/planejada — máquina, OP, datas planejadas, quantidade |
| `view_usr_OPxPedidoEntregasTeste` | Data de entrega por OP/pedido |
| `View_usr_Entregas_Desempenho` | Desempenho de entrega (lead time) |

### Quadro de decisão por planilha (o que dá pra ligar direto vs. não)

| Fonte | Onde vem de verdade | Situação |
|---|---|---|
| `apontamentos` (principal) | SQL Server, `View_usr_apontamentos_999999`, aba "Base Apontamento" | ✅ já ligado (via Excel refresh + Drive, não conexão direta) |
| `apontamentos` (alternativa) | mesma view, aba "BASE_APARAS"/"BASE_DETALHE" | ✅ já ligado |
| `producao_kg` | mesma view, aba "Base Apontamentos (kg)" | ✅ já ligado |
| `refugo_producao` | SQL Server, mesmo servidor (acessado pelo IP), consulta nativa `SELECT ... FROM Apontamentos WHERE CodApont = 40` | ✅ já ligado |
| `aderencia_programacao` | Aderência Semanal.xlsx, aba **"ADERÊNCIA DIÁRIA"** (planejado × produzido já cruzados, 15.550 linhas) | ✅ ligado em 2026-09-11 (ver seção 8) — **falta rodar 2 SQLs no Supabase** |
| Produtividade m²/h (`producao_metros`) | Machine Card Oficial.xlsx, aba/consulta "Produção" — junta a view principal com `EstrProcessos` (largura) | 🔴 **adiado de propósito (Opção 5, seção 10)** |
| `maquinas` (DIM_EQTOS) | **NÃO é SQL Server** — `Excel.Workbook(File.Contents(...\DIM_EQTOS & GRUPO EQTO.xlsx))`, arquivo numa pasta do OneDrive corporativo da área de Produção (caminho e dono omitidos) | ✅ já ligado — chega embutido dentro do Machine Card quando alguém atualiza o Excel, sem precisarmos de acesso direto ao OneDrive |
| "Classificação" (Machine Card) | Idem, outro arquivo na mesma pasta: `Classificação_Apontamentos.xlsx` | Não ligado ao Supabase ainda, mesmo caminho de acesso do item acima quando for a vez |
| Absenteísmo / MOD / MOI / Rateio | OneDrive corporativo, pasta de KPIs, `Absenteísmo.xlsx` (caminho omitido) | Não ligado ainda; mesmo caminho (chega embutido no Machine Card) |
| `fardos_aparas` | Planilha estática (Sequenciamento mensal), sem Power Query | ✅ já ligado — não tem "fonte SQL" pra puxar, é mantida na mão mesmo |
| `tendencia_mensal` | Graficos Tendência.xlsx, estática, sem Power Query | Existe mas sai vazia no build — não investigado ainda (ver seção 11) |
| `refugo_aparas_historico` | Refugo Aparas.xlsx — tem `DataMashup` mas o código M vem **vazio**, sem `xl/connections.xml` — consulta órfã/abandonada | ✅ já ligado (via planilha estática mantida na mão) |

**Achado importante sobre `Classificação`**: existem DUAS consultas com
esse mesmo nome em arquivos diferentes e são coisas DIFERENTES — uma em
`Indicadores Diário.xlsx` é uma tabela estática dentro do próprio
workbook (`Excel.CurrentWorkbook()`); outra em `Machine Card.xlsx` vem
do OneDrive (`Classificação_Apontamentos.xlsx`). Não confundir.

**Arquivos que constavam no pedido original do usuário mas não existem
na pasta do Drive hoje**: `Aderência Máquinas - Diária.xlsx` e
`Histórico Aderência Programação.xlsx` — é por isso que
`aderencia_maquinas_diaria` está sem dado real e `aderencia_programacao`
estava órfã até a correção da seção 8.

## 8. Última mudança de código aplicada (commit `c20ee7a`, já pushado)

Ligar `aderencia_programacao` na aba real (`ADERÊNCIA DIÁRIA`), sem
precisar de SQL Server nem OneDrive diretos — o arquivo já está na pasta
do Drive de sempre, só faltava o `sync-drive` saber ler essa aba.

Arquivos alterados:
- `backend/sync-drive/lib.js` — `TABLE_DEFS` de `aderencia_programacao`
  trocado (fonte antiga não existe mais); `RETENTION_DATE_COL`,
  `HEADER_ALIASES` (`DtEntrega` → `dt_entrega`), `DB_SHEET_NAME`
  atualizados junto.
- `backend/sync-drive/bases-catalog.js` — removida a entrada
  `DB_ADERENCIA_DIARIA` do inventário (promovida pra tabela real; deixar
  as duas geraria aba duplicada no arquivo central).
- `backend/schema_data.sql` — tabela `aderencia_programacao` recriada
  com as colunas reais (`num_ordem, maquina, dt_ini_plan, qtd_planejada,
  produto, qtd_produzida, ano, base, dt_entrega`) em vez das colunas do
  arquivo morto antigo. Migração automática: só recria se detectar a
  coluna antiga `recurso_ctr` (tabela estava vazia/órfã, sem risco de
  perda de dado real).
- `backend/schema_views.sql` — `v_maquinas_resumo` ajustada pras colunas
  novas. **Importante**: renomeei a saída de `km_planejado`/
  `km_realizado` pra `qtd_planejada`/`qtd_produzida` **de propósito** —
  a fonte antiga rotulava como "km" e chegou a mostrar 12,3 bilhões de
  "km" (número absurdo, sintoma da fonte morta). A unidade real de
  `qtd_planejada`/`qtd_produzida` na fonte NOVA não foi confirmada ainda
  — não relabelar como km/m sem confirmar contra o dado real.
- `demo/upload.html` — espelha a troca, pro botão de upload manual ficar
  em sintonia com o sync automático.

Testes feitos (sem acesso a dado real, só lógica):
`detectTables`/`detectSheet` roteiam pro arquivo e aba certos mesmo com
várias abas de consulta no mesmo workbook; `coerceRow` mapeia
corretamente um cabeçalho simulado com os nomes reais (incluindo o
alias `DtEntrega`).

### ⚠️ Pendência do usuário (bloqueante pra essa parte funcionar)

Ele precisa rodar, no SQL Editor do Supabase, **nesta ordem**:
1. `backend/schema_data.sql`
2. `backend/schema_views.sql`

Eu não rodei isso automaticamente — desde 2026-09-14 combinei que só
entrego o SQL, ele decide quando rodar (ver seção 3).

## 9. Nota sobre uma mudança que EU apliquei direto no Supabase (antes da regra da seção 3)

Durante a investigação do TMR, adicionei 2 colunas na tabela
`apontamentos` via `mcp__Supabase__apply_migration` (sem pedir
confirmação antes — isso foi ANTES do usuário pedir que eu parasse de
fazer isso):
```sql
alter table public.apontamentos add column if not exists classificacao_disp  text;
alter table public.apontamentos add column if not exists classificacao_horas text;
```
Essa mudança **já está em produção**, não foi revertida (o usuário não
pediu reversão, só pediu que eu parasse de fazer isso *dali pra frente*).
Se uma sessão futura for reconstruir o schema do zero, essas 2 colunas
precisam existir.

## 10. Decisão de escopo — SQL Server Agent adiado (2026-09-14, "Opção 5")

Contexto: depois de mapear tudo (seção 7), tentei resolver a
produtividade m²/h com conexão direta ao SQL Server. Isso esbarrou numa
sequência de obstáculos reais, nessa ordem:

1. Servidor só acessível de dentro da rede/VPN da Gualapack → GitHub
   Actions normal (nuvem) não alcança.
2. Sem máquina dedicada sempre ligada na rede → precisaria rodar no PC
   de trabalho do usuário.
3. PC de trabalho **sem permissão de administrador** → nem o instalador
   do Node nem o serviço do Windows pro runner do GitHub Actions
   funcionam do jeito padrão.
4. Contornei os dois pontos de admin (Node portátil em .zip, runner em
   modo interativo com `.\run.cmd`, sem instalar como serviço) — cheguei
   a escrever e commitar essa infraestrutura inteira (`backend/sync-mssql/`,
   `.github/workflows/sync-mssql.yml`, `backend/README-mssql-sync.md`,
   `backend/schema_mssql.sql`, com conexão NTLM via pacote `mssql`
   100% JS, sem precisar de ODBC Driver nem Visual Studio Build Tools).
5. O usuário considerou os passos "não muito legais" de fazer no PC de
   trabalho (baixar executável solto, deixar janela aberta, atalho na
   inicialização) — pediu outros métodos.
6. Propus 3 alternativas sem tocar no PC: (A) pedir ao TI pra liberar
   IP no firewall, (B) SQL Server Agent exportando CSV pra uma pasta
   sincronizada com o Drive (sem pedir acesso de fora pra dentro — o
   banco empurra o dado pra fora, do jeito que hoje uma pessoa empurra
   na mão), (C) perguntar se já existe máquina disponível.
7. O usuário pediu ainda mais opções → adicionei (4) BI/gateway já
   existente, e (5) simplesmente adiar essas 2-3 métricas específicas
   pra uma fase futura, sem automação nenhuma por enquanto.
8. **Decisão final: Opção 5.** Toda a infraestrutura de conexão direta
   (`backend/sync-mssql/`, workflow, README, schema) foi **removida** do
   repositório no commit `c20ee7a` (fica só no histórico do git — não
   tracked no HEAD da branch de trabalho). Nenhum código relacionado
   está ativo hoje.

**O que fica pra "futuramente"** (não fazer sem o usuário pedir de novo
explicitamente):
- Produtividade m²/h (`producao_metros`, Machine Card).
- Qualquer decisão sobre expor o SQL Server pra fora da rede (Opção A/B/C/4
  da lista acima) — precisa envolver TI/DBA, o que o usuário não decidiu
  ainda.
- Ligar `Classificação_Apontamentos.xlsx` e `Absenteísmo.xlsx`
  (OneDrive) em tabelas do Supabase — hoje só o `maquinas` (via
  DIM_EQTOS) está ligado; essas duas nem foram pedidas ainda.

## 11. Itens em aberto que NINGUÉM decidiu ainda (não confundir com "adiado de propósito")

- **`tendencia_mensal` sai vazia no build** (`[skip] "DB_TENDENCIA" ->
  tendencia_mensal: aba vazia ou sem linha válida` no log do sync mais
  recente) — não investigado, não é a mesma coisa que a decisão da
  seção 10.
- **Gantt** — cobrir com `aderencia_programacao` (aba ADERÊNCIA DIÁRIA,
  que tem `dt_ini_plan`/`qtd_planejada`/`num_ordem`/`maquina`) ainda não
  foi testado contra o componente real do painel — é a próxima peça da
  FASE 2 depois que a Aderência em si estiver validada.
- **17 sparklines usando `Math.random()`** e o texto fixo "+6,2 m²/h vs.
  mês anterior" — ainda não tocados (FASE 4 do plano original).
- **Filtro de período** — afeta só 1 de 25 componentes hoje (FASE 4).
- **WIP/Carteira** (5 componentes) — fixtures no código, fonte não
  investigada (FASE 5).
- **Velocidade nominal** — depende da aba "Dinamica" dentro de
  `Base Aparas - *.xlsx`, que é uma TABELA DINÂMICA do Excel (pivot),
  não uma consulta Power Query — vai precisar de um parser dedicado
  pra ler pivot table, diferente de tudo que já foi feito. Não iniciado.
- **Metas por máquina** — a aba "Metas" dentro de `Indicadores
  Diário.xlsx` **não é uma consulta Power Query** (não aparece em
  nenhuma `xl/connections.xml` inspecionada) — é uma aba estática,
  preenchida na mão dentro do próprio arquivo. Já está na pasta do
  Drive, só falta mapear em `TABLE_DEFS`/`bases-catalog.js` — mais
  simples que produtividade, não devia ter sido colocada na mesma
  categoria da seção 10 se o usuário quiser retomar rápido.
- **`DB_CLASSIFICACAO_APONT`** ("Classificação Oficial" dentro de
  `Indicadores Diário.xlsx`) — mesma situação: não é Power Query, é aba
  estática, já mapeada em `bases-catalog.js` como inventário mas não
  promovida a tabela do Supabase.

## 12. Onde estão as coisas no repositório (mapa rápido)

| O quê | Onde |
|---|---|
| Lógica de detecção de tabela/aba, normalização de coluna | `backend/sync-drive/lib.js` |
| Monta o arquivo central a partir dos originais | `backend/sync-drive/build-database-central.js` |
| Carga do arquivo central pro Supabase | `backend/sync-drive/sync.js` |
| Catálogo de bases de inventário (29 bases, algumas ainda não promovidas) | `backend/sync-drive/bases-catalog.js` |
| Extrator de bases com rastreabilidade (usado no mapeamento, fase 2) | `backend/sync-drive/collect-bases.js` |
| Schema das tabelas brutas | `backend/schema_data.sql` |
| Schema base (auth, sync_log, etc.) | `backend/schema.sql` |
| Views agregadas pro painel | `backend/schema_views.sql` |
| Upload manual (plano B) | `demo/upload.html` |
| O painel em si | `demo/index.html` |
| Login | `demo/login.html` |
| Config pública do Supabase (anon key, URL) | `demo/supabase-config.js` |
| Os 6 relatórios de mapeamento | `docs/mapeamento/*.md` |
| Este documento | `docs/CONTEXTO_PROJETO_2026-09.md` |

## 13. Convenções e "gotchas" técnicos que já custaram tempo (evitar repetir)

- **Uma `XLSX.read()` descompacta o zip inteiro.** Nunca ler
  sheet-por-sheet num loop — sempre uma leitura por arquivo passando
  todas as abas necessárias de uma vez (`sheets: [...]`).
- **`array.push(...outroArray)` estoura a pilha acima de ~125 mil
  itens** — usar `for...of` com `.push()` simples pra arrays grandes.
- **`sheetRows: N` limita o PARSE, não o range reportado** —
  `sheet["!fullref"]` (ou `!ref` se não truncado) continua dando o
  tamanho real da aba, útil pra sondar sem materializar tudo.
- **`customXml/itemN.xml` do Excel pode vir em UTF-16LE com BOM** — nunca
  assumir UTF-8 em parte interna de `.xlsx` sem checar o BOM primeiro.
- **`unzip -p` trata `[`, `]`, `?`, `*` como wildcard** mesmo passando
  argumento direto (sem shell) — escapar com `\` na frente.
- **Troca-por-arquivo (`REPLACE_BY_SOURCE`) tem que limpar órfãos** —
  comparar com a listagem real de arquivos da pasta, não só com o que
  apareceu nesta rodada (bug da seção 6, item 3).
- **Ferramentas temporárias de investigação SÓ disparam
  (`workflow_dispatch`/`schedule`) se estiverem na branch `main`** — é
  limitação da plataforma GitHub, não escolha de configuração. Padrão
  usado a sessão toda: sobe só o(s) arquivo(s) da ferramenta na `main`
  (branch separada tipo `tmp-*`, nunca commit direto), dispara, lê o
  log, remove de volta. Nunca deixar ferramenta temporária esquecida lá.
- **`workflow_dispatch` current run costuma levar de 30s a 2 min** pra
  arquivos pequenos/médios do Drive — arquivos de 40-100 MB levam
  20-35s só de download.

## 14. Estilo de trabalho esperado (pra manter consistência com o que já foi feito)

- Comentários em português, no mesmo tom técnico-direto já usado no
  código (explicar o PORQUÊ de uma decisão não óbvia, não só o quê).
- Nunca dar número/gráfico sem validar contra o arquivo original
  primeiro — o usuário audita isso de perto e já pegou pelo menos 2
  conclusões erradas minhas nesta sessão (registradas com correção
  explícita nos commits e no `VALIDACAO_DASHBOARD.md`, sem tentar
  esconder ou minimizar).
- Preferir simplicidade radical a "solução elegante" quando o usuário
  sinalizar preferência por isso (foi exatamente o que aconteceu na
  seção 10 — 3 rodadas de solução técnica cada vez mais sofisticada
  foram descartadas em favor de "deixa pra depois").
- Perguntar antes de assumir arquitetura quando a resposta muda o
  tamanho do trabalho (rede, acesso, admin) — mas sem re-perguntar a
  mesma coisa de formas diferentes repetidamente; se o usuário sair de
  uma pergunta sem responder, é sinal pra parar e não insistir.
