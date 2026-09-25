# Painel de Produção — Gualapack Jaguariúna

Painel web com os indicadores de produção da fábrica de Jaguariúna: TMR,
aparas e refugo, produtividade, velocidade, aderência ao plano e a linha do
tempo das máquinas. Os números vêm das mesmas planilhas que o time já usa, e
o painel se atualiza sozinho todo dia de madrugada.

**Painel:** https://felipepanini.github.io/Dashboard-Gualapack/demo/ (acesso
com login; cadastro só com chave de convite).

> **Em construção: o data hub ([`hub/`](./hub/README.md)).** Ele lê as
> planilhas de uma pasta na Área de Trabalho, valida cada indicador contra a
> fonte oficial e publica o resultado no Supabase. Com o
> `hub/sql/supabase/002_cartoes.sql` aplicado, **todos os cartões** do painel
> saem do hub, com as regras do BI Indicadores Produção aplicadas às mesmas
> planilhas que ele lê (conferidos mês a mês contra o BI), e a página
> **Qualidade dos dados** (`demo/qualidade.html`) mostra cada número, a
> fonte, o status e as divergências. As planilhas chegam sozinhas da pasta
> compartilhada. Sem o 002, o painel segue com o fluxo abaixo.

---

## Como o dado chega na tela

```
SQL Server da fábrica (banco Metrics) + planilhas mantidas pelo time
        │  Power Query no Excel ("Atualizar Tudo")
        ▼
Planilhas originais (.xlsx) numa pasta do Google Drive
        │
        │  ETAPA 1 — todo dia às 02:00 (Brasília)
        │  backend/sync-drive/build-database-central.js
        ▼
DATABASE_GUALAPACK.xlsx — arquivo central, na mesma pasta do Drive
        │
        │  ETAPA 2 — logo depois, só se a etapa 1 deu certo
        │  backend/sync-drive/sync.js
        ▼
Supabase (Postgres) — tabelas brutas + funções que somam por período
        │
        ▼
demo/index.html — o painel (GitHub Pages)
```

As duas etapas rodam no GitHub Actions (nuvem). Elas só falam com o Google
Drive e com o Supabase, os dois acessíveis pela internet. Nenhum computador
da empresa precisa ficar ligado.

---

## Linha de raciocínio

Por que o projeto é do jeito que é. Cada item foi uma escolha entre
alternativas, e o motivo continua valendo enquanto a situação não mudar.

1. **A fonte são as planilhas que o time já atualiza.** Os números nascem no
   SQL Server da fábrica, mas ele só é acessível de dentro da rede da
   empresa. Ligar direto exigiria uma máquina sempre ligada na rede,
   permissão de administrador ou uma liberação da TI, e nada disso estava
   disponível. As planilhas já puxam do SQL Server pelo Power Query, então a
   pasta do Drive virou a porta de entrada. Se a TI liberar acesso um dia, só
   a etapa 1 muda; o resto continua igual.

2. **Um arquivo central antes do banco.** As planilhas pesam de 15 a 100 MB e
   somam mais de 200 abas. A etapa 1 faz essa leitura pesada uma vez e grava
   um arquivo só, que abre no Excel pra conferência. A aba `DB_CONTROLE` diz
   o que entrou em cada aba, de quais arquivos, o período coberto e o que
   falhou. A etapa 2 lê só esse arquivo, que é bem mais leve.

3. **O navegador nunca lê tabela bruta.** A tabela de apontamentos tem
   centenas de milhares de linhas. Funções no banco somam por máquina, motivo
   ou mês e devolvem dezenas de linhas. O calendário do topo passa o período
   escolhido como parâmetro pra essas funções.

4. **Login por convite, dados protegidos no banco.** A chave pública do
   Supabase fica no site, mas só lê o que as regras de acesso (RLS) permitem,
   e só pra quem está logado. O cadastro exige uma chave de convite, validada
   no servidor.

5. **Doze meses de histórico.** O plano gratuito do Supabase tem 500 MB, e
   vários anos de eventos de máquina estouraram esse limite uma vez. As
   tabelas de eventos guardam só os últimos 12 meses.

6. **Cada arquivo substitui o que gravou antes.** Eventos de máquina não têm
   uma chave única confiável. A cada carga, as linhas de um arquivo são
   apagadas e gravadas de novo. Se um arquivo falhar na etapa 1 (aba grande
   demais, erro de leitura), o dado anterior dele é mantido. Essa proteção
   foi criada depois que, em 18/09, uma aba pulada zerou as horas do ano.

7. **Uma fonte por indicador, e divergência vira pergunta.** Quando a
   planilha e o painel discordam, os dois números aparecem lado a lado com a
   causa provável. Quem decide qual vale é o dono do indicador, não o código.

8. **Nada inventado com cara de dado real.** A regra é mostrar vazio quando o
   dado não existe. Os lugares que ainda não seguem essa regra (aba WIP &
   Carteira, minilinhas dos cards, apara 0% sem peso bruto) têm aviso na tela
   ou estão listados nas pendências abaixo.

---

## Onde está cada coisa

| Caminho | O que é |
|---|---|
| [`demo/`](./demo/) | O site: `index.html` (painel), `login.html`, `admin.html` (convites), `qualidade.html` (validação publicada pelo hub), `upload.html` (upload manual, legado). O nome `demo` ficou porque é o endereço já publicado. |
| [`backend/sql/`](./backend/sql/) | Estrutura do banco: login e convites, tabelas dos dados, funções e views. |
| [`backend/sync-drive/`](./backend/sync-drive/) | A carga diária (etapas 1 e 2) e as regras de leitura das planilhas (`lib.js`). |
| [`backend/functions/`](./backend/functions/) | Funções do Supabase: cadastro com convite e upload manual. |
| [`.github/workflows/`](./.github/workflows/) | `build-database-central.yml` (etapa 1, agendada) e `sync-drive.yml` (etapa 2, encadeada). |
| [`docs/guias/`](./docs/guias/) | Passo a passo: configurar o Supabase, a carga automática, o upload manual. |
| [`docs/mapeamento/`](./docs/mapeamento/) | Levantamentos: inventário das 220 abas, redundâncias, origem de cada número, validação contra as planilhas. |
| [`docs/historico/`](./docs/historico/) | Retrato do projeto em 14/09/2026, com as decisões e descartes até ali. |
| [`tools/`](./tools/) | Script local pra cortar uma planilha grande numa aba só (apoio ao upload manual). |
| [`hub/`](./hub/) | Data hub em construção: coleta local das planilhas, validação de cada indicador contra a fonte oficial e publicação do resultado no Supabase (schema `trusted`). Python + DuckDB, roda no PC. |

---

## De onde vem cada número

| No painel | Calculado em | Tabela | Planilha → aba |
|---|---|---|---|
| TMR por máquina | `rpc_maquinas_resumo` | `apontamentos` + `classificacao_apontamento` | Indicadores Diário → Base Apontamento e Classificação Oficial |
| Apara por máquina | `rpc_maquinas_resumo` | `producao_kg` | Indicadores Diário → Base Apontamentos (kg) |
| Aderência por máquina | `rpc_maquinas_resumo` | `aderencia_programacao` | Aderência Semanal → ADERÊNCIA DIÁRIA |
| Perda por motivo, OPs com mais refugo | `rpc_perda_por_motivo`, `rpc_ops_refugo` | `apontamentos` | Indicadores Diário + Base Aparas → BASE_DETALHE |
| Apara por classificação | `rpc_perda_por_classificacao` | `apontamentos` | idem |
| Horas paradas por motivo | `rpc_downtime_por_status` | `apontamentos` | Indicadores Diário → Base Apontamento |
| Produtividade (m²/h) e velocidade | `rpc_produtividade_maquina` | `producao_metros` | Machine Card → Produção (Metros) |
| Apara apontada (mensal) | `v_fardos_mensal` | `fardos_aparas` | Sequenciamento mensal → COMPLETOS |
| Apara confirmada (mensal) | `v_scrap_bi_mensal` | `scrap_bi_mensal` | Sequenciamento Acumulado → Percentual Scrap BI |
| Refugo por máquina | `v_refugo_producao_maquina` | `refugo_producao` | Refugo Produção → Consulta Perda |
| Produção e refugo em kg (mensal) | `v_producao_kg_mensal` | `producao_kg` | Indicadores Diário → Base Apontamentos (kg) |
| Linha do tempo | `v_apontamentos_ultimo_dia` | `apontamentos` | Indicadores Diário → Base Apontamento |
| Selo "dados até" | `v_dados_status` | todas | — |
| Lista de máquinas e grupos | — | `maquinas` | Machine Card → DIM_EQTOS & GRUPO EQTO |
| WIP & Carteira | — | nenhuma | valores de referência, com aviso na tela |

TMR = horas produzindo ÷ (horas totais − horas planejadas: fim de turno,
refeição, preventiva, falta de programação…). A classificação de cada código
de apontamento vem do cadastro oficial da planilha.

Detalhe completo, com validação número a número: [`docs/mapeamento/`](./docs/mapeamento/).

---

## Rotina

1. **Atualizar as planilhas** no Excel (Dados → Atualizar Tudo) e deixar a
   versão nova na pasta do Drive.
2. **Às 02:00** a etapa 1 roda sozinha; a etapa 2 vem em seguida.
3. **Precisa antes?** GitHub → aba Actions → *Montar base central
   (DATABASE_GUALAPACK.xlsx)* → Run workflow. A etapa 2 começa sozinha quando
   a 1 termina, em cerca de 10 minutos no total.
4. **Conferir:** o selo no topo do painel mostra até que dia vai o dado, e
   fica âmbar quando passa de 2 dias. A aba `DB_CONTROLE` do arquivo central
   mostra o que falhou.

Passo a passo e erros comuns: [docs/guias/carga-automatica-drive.md](./docs/guias/carga-automatica-drive.md).

---

## Regras do projeto

- **Segredos só em GitHub Secrets.** Senha, token, chave de API e credencial
  do Google ou do Supabase nunca entram no código. A chave pública do
  Supabase em `demo/supabase-config.js` é pública por natureza.
- **Repositório público.** Nome de servidor interno, IP, caminho de rede e
  dado pessoal de colega não entram em arquivo nenhum.
- **Os arquivos originais do Drive não são alterados.** A carga só lê, e só
  grava no `DATABASE_GUALAPACK.xlsx`.
- **Nada de dado fictício com cara de real.** Melhor mostrar "sem dados" do
  que 0% ou um número inventado.
- **O visual do painel não muda** sem pedido explícito. Mudança de dado não
  mexe em layout, cor nem tipografia.
- **Mudança de estrutura no banco** (tabela, função, view) é entregue como
  SQL em `backend/sql/`. Rodar no Supabase é decisão do dono do projeto.
- **Divergência entre fontes** é mostrada com as duas versões e a causa
  provável. Nenhum valor é escolhido em silêncio.

---

## Pendências e limitações conhecidas

- **Definição do TMR a decidir.** O painel desconta as horas planejadas do
  total. A planilha Graficos Tendência conta tudo no total, então o TMR do
  painel sai maior. Falta escolher qual definição vale.
- **Horas de 2025 fora da carga.** A aba Base Apontamento de 2025 tem 379.792
  linhas, acima do teto de 360.000 que a etapa 1 consegue ler. Setembro a
  dezembro de 2025 ficam sem horas. A aba de 2026 cresce cerca de mil linhas
  por dia e chega perto do teto no fim do ano.
- **Minilinhas dos cards são sorteadas.** As 17 minilinhas de tendência nos
  cards de indicador são geradas aleatoriamente. Ou ganham uma série real, ou
  saem da tela; as duas opções pedem uma decisão, porque a segunda muda o
  visual.
- **Referência em caso de falha parcial.** Se só as consultas de refugo por
  máquina ou de produção em kg falharem, esses dois gráficos mostram valores
  de referência enquanto o selo continua dizendo "dado real".
- **Produtividade usa horas de máquina.** O Power BI divide por horas
  trabalhadas da Folha de Ponto, que não está no Drive. O rótulo do card diz
  isso.
- **Peso bruto cada vez menos preenchido.** Na aba Base Apontamentos (kg),
  o preenchimento do peso bruto caiu de 72–82% para 20–30% a partir de
  maio/2026. Em períodos curtos, a apara de uma máquina sem peso bruto
  aparece como 0% em vez de "sem dados".
- **Apara por classificação** mistura populações diferentes (o refugo vem de
  mais máquinas que o peso bruto). Aguardando uma fonte com classificação e
  peso na mesma linha.
- **Sem fonte hoje:** `aderencia_maquinas_diaria` (o arquivo saiu da pasta),
  `tendencia_mensal` (sai vazia) e as abas TMR do Graficos Tendência (ainda
  não carregadas).
- **Unidade da aderência** (`qtd_planejada` / `qtd_produzida`) ainda não
  confirmada. Por isso não está rotulada como km nem m.
- **Upload manual desatualizado.** A tela `upload.html` e a função `ingest`
  não conhecem as 3 tabelas mais novas. Atualizar ou aposentar: decisão
  pendente.
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
