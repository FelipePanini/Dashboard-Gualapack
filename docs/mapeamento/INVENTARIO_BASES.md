# Inventário de bases — Gualapack Jaguariúna

Levantamento feito em 2026-09-09 abrindo **todos os arquivos da pasta do Drive**,
aba por aba, via `backend/sync-drive/inspect-all.js` rodando no GitHub Actions
(os arquivos somam ~570 MB e não cabem em leitura direta).

Nenhum arquivo original foi alterado. Nenhuma base foi descartada.

## Resumo

| Métrica | Valor |
|---|---|
| Arquivos inspecionados | 21 (17 com log completo capturado) |
| Abas encontradas | 220 |
| Linhas somadas | ~3,5 milhões |
| Abas efetivamente usadas hoje | 7 |
| Abas com dado estruturado ainda **não** usado | ~120 |

O painel atual usa cerca de **3% das abas** existentes.

## Arquivos, por volume de dado

| Linhas | Abas | Tamanho | Arquivo |
|---:|---:|---:|---|
| 699.443 | 26 | 64,5 MB | Machine Card Oficial - 2025.xlsx |
| 642.570 | 16 | 75,7 MB | Base Aparas - 2025.xlsx |
| 624.387 | 7 | 68,6 MB | Base Aparas - 2024.xlsx |
| 613.044 | 10 | 87,8 MB | Indicadores Diário - 2025.xlsx |
| 419.426 | 32 | 35,5 MB | Machine Card Oficial - Genérico.xlsx |
| 192.656 | 18 | 14,7 MB | Aderência Semanal.xlsx |
| 149.503 | 11 | 20,2 MB | Base Aparas - 2026.xlsx |
| 148.608 | 9 | 12,2 MB | Refugo Produção.xlsx |
| 10.906 | 10 | 0,8 MB | Refugo Aparas.xlsx |
| ~1.500–2.200 | 9–11 | 0,4 MB | 9 arquivos de Sequenciamento de Fardos (mensais) |
| 301 | 14 | 0,2 MB | Graficos Tendência.xlsx |

Também existe na pasta um **"Sequenciamento Acumulado 2026.xlsx"** (1.724 linhas
já carregadas hoje em `fardos_aparas`) que não constava no inventário original
combinado — ele é pego automaticamente porque o nome casa com "sequenciamento".
**Pendente de confirmação:** é um acumulado que duplica os mensais?

## O que cada arquivo contém

### Indicadores Diário - 2025 / 2026.xlsx — 10 abas
Fonte principal do painel hoje.

| Aba | Linhas | Conteúdo | Uso hoje |
|---|---:|---|---|
| Base Máquina_Embalagem | 170.099 | Evento de máquina (22 col) | ✅ `apontamentos` |
| **Base Apontamento** | **379.792** | Mesmo evento **+ CLASSIFICAÇÃO DISP., CLASSIFICAÇÃO HORAS, CHAVE** (25 col) | ❌ |
| Base Apontamentos (kg) | 16.065 | Produção/refugo em kg por OP | ✅ `producao_kg` |
| Engenharia | 43.060 | Cadastro de produto (passo, largura, cilindro) | ❌ |
| **Metas** | **3.668** | DATA \| MÁQUINA \| META — meta diária por máquina | ❌ |
| Acumulado Mês | 24 | Pivot de produção/perda | ❌ (pivot) |
| **Dinamica** | 46 | Bloco de **metas de velocidade**: m/hora, m/min, horas/dia, target por turno | ❌ |
| Modelo Diário | 66 | Painel diário: aderência e disponibilidade por turno | ❌ (painel) |
| **Classificação / ClassificaçãoOficial** | 112 | COD \| DESCRIÇÃO \| **CLASSIFICAÇÃO DISP.** \| **CLASSIFICAÇÃO** | ❌ |

> `Base Apontamento` já traz a classificação de disponibilidade calculada
> (IMPRODUTIVO / PLANEJADO / SETUP / INICIALIZAÇÃO / INATIVIDADE), que é
> exatamente a categoria que o TMR usa. Hoje o painel usa a aba menor,
> sem essa classificação.

### Machine Card Oficial - 2025 / Genérico.xlsx — 26 e 32 abas
O arquivo mais rico e o menos aproveitado (usamos 1 aba de 26).

| Aba | Linhas | Conteúdo | Uso hoje |
|---|---:|---|---|
| DIM_EQTOS & GRUPO EQTO | 35 | Cadastro de máquinas | ✅ `maquinas` |
| **Horas** | **416.529** | Apontamento de horas por OP/recurso | ❌ |
| **Produção Bruto** | **242.533** | Produção com peso bruto por OP | ❌ |
| **Produção (Metros)** | 11.070 | **Qtd Produzida (Metros), Produção M², Largura Real** | ❌ |
| **Absenteísmo** | 4.735 | RH: colaborador, centro de custo, horas, faltas | ❌ |
| **MOD / MOI / MO_RATEIO / MO_CLASSIFICAÇÃO** | ~2.500 cada | Mão de obra direta/indireta e rateio por máquina | ❌ |
| **Cores por OP** | 6.593 | Nº de cores e nº de OPs por estrutura | ❌ |
| Larguras (Real) | 14.918 | CodEstrutura → largura real | ❌ |
| AVAILABLE HOURS | 161 | Horas disponíveis por máquina | ❌ |
| MACHINE CARD | 503 | Ficha da máquina (38 col) | ❌ |
| HOURS DESCRIPTION | 145 | Detalhamento das horas | ❌ |
| Classificação | 114 | COD \| TIPO \| CLASSIFICAÇÃO | ❌ |
| D_PRODUTIVIDADE / KPI_MasterPlan / Consolidação / TABELA | 9–82 | KPIs e produtividade (Sqm/MOD+MOI) | ❌ (painéis) |

> `Produção (Metros)` tem **Produção M²** e **Largura Real** — é a base que
> falta para o indicador de produtividade (m²/h) que hoje aparece vazio no painel.
> `Absenteísmo` e `MOD/MOI` abrem um domínio inteiro (pessoas) que o painel não cobre.

### Aderência Semanal.xlsx — 19 abas

| Aba | Linhas | Conteúdo | Uso hoje |
|---|---:|---|---|
| **ADERÊNCIA DIÁRIA** | 15.550 | NumOrdem, Máquina, DtIniPlan, QtdPlanejada, Qtd Produzida | ❌ |
| **ADERÊNCIA SEMANAL** | 6.694 | Máquina, OP, Planejado, Início, Semana | ❌ |
| **Produção Antiga** | 113.394 | Apontamento em formato antigo (19 col) | ❌ (legado) |
| Produção | 8.241 | NumOrdem, CodRecurso, DtProducao, Produção, Semana | ❌ |
| Programação | 718 | Programação por OP/máquina | ❌ |
| **DtEntrega** | 464 (55 col) | Pedidos: status, datas de emissão/entrega, lead time | ❌ |
| Base OP Faturamento / Backup | 208 / 283 | OP × setor × produto planejado | ❌ |
| Semanas / Tabela Semana | 427 | Calendário DATA → SEMANA | ❌ |
| Engenharia | 44.875 | Cadastro (com LARGURA REAL a mais) | ❌ |
| Din / DIN SEMANAL / DIN PROG. DIÁRIA / Gráfico / Print09_03 / Anlise Março26 / Planilha2 / Planilha3 | — | Pivots e painéis | ❌ (pivot) |

### Refugo Produção.xlsx — 9 abas

| Aba | Linhas | Conteúdo | Uso hoje |
|---|---:|---|---|
| Consulta Perda | 68.733 | Refugo por evento/máquina/motivo | ✅ `refugo_producao` |
| **G_m²** | 35.975 (28 col) | Engenharia + cliente + **m²** por produto | ❌ |
| **Larguras** | 43.331 | Cadastro com largura real | ❌ |
| **Formulário - Controle Perdas** | 367 | **VALOR SISTEMA × VALOR APONTADO × DELTA** — divergências | ❌ |
| Backup | 145 | Versão anterior do formulário | ❌ (legado) |
| Representatividade / Planilha1/2/3 | 5–26 | Painéis auxiliares | ❌ |

### Base Aparas - 2024 / 2025 / 2026 / Genérico.xlsx — 7 a 16 abas

| Aba | Linhas (2025) | Conteúdo | Uso hoje |
|---|---:|---|---|
| BASE_DETALHE | 22.647 | Evento de máquina (22 col) | ✅ `apontamentos` |
| **Base Produção** | **367.520** | **Mesmas 22 colunas** | ❌ |
| **BASE_MÁQ_EMB** | **168.835** | **Mesmas 22 colunas** | ❌ |
| **BASE_PROD** | 12.413 | Produção por OP **com CLIENTE, TIPO CLIENTE, SKU** | ❌ |
| Engenharia | 43.031 | Cadastro de produto | ❌ |
| Base SKU | 13.314 | De-para código PA ↔ Engenharia | ❌ |
| Sylvamo / DIM / Dinamica / Planilha1–7 | — | Pivots e rascunhos | ❌ (pivot) |

> Três abas com **as mesmas 22 colunas** no mesmo arquivo (367k, 168k e 22k
> linhas) — e usamos a menor. Ver `RELATORIO_REDUNDANCIAS.md`.

### Refugo Aparas.xlsx — 10 abas

| Aba | Linhas | Conteúdo | Uso hoje |
|---|---:|---|---|
| Conta Refugo | 66 (15 col) | Volume/scrap mensal JGR e ORF | ✅ (só 5 das 15 colunas) |
| Histórico Refugo | 37 | Mesma série, com YTD | ❌ |
| **Produção** | 6.990 | Produção diária por segmento e planta | ❌ |
| **Refugo - JGR** | 1.617 | Refugo/refile diário JGR | ❌ |
| **Refugo - OF** | 1.342 | Refugo/refile/borra diário ORF | ❌ |
| Refugo Confirmado_Classificação | 623 | Dentro × fora de processo | ❌ |
| **Limite_Fardo** | 25 | **Limite máximo de descarte por mês (meta)** | ❌ |
| Master Plan / Refugo_Separado / Porcent. Aparas | 63–97 | Recortes da mesma série | ❌ |

### Sequenciamento dos Fardos (9 arquivos mensais) — 9 a 11 abas cada

| Aba | Linhas | Conteúdo | Uso hoje |
|---|---:|---|---|
| COMPLETOS | ~420–478 | Fardo a fardo (bruto/líquido) | ✅ `fardos_aparas` |
| Detalhes1 | ~492 | Mesmas colunas + descrição da classificação | ❌ |
| DETALHES / DETALHES - FP | 87–711 | Eventos fora de processo | ❌ |
| FORMULÁRIOS | 329 | OP, descrição, peso, **SETOR** | ❌ |
| CLASSIFICAÇÃO | 12–14 | Cadastro de motivos | ❌ |
| TIPO REFUGO | 16 | Cadastro de material + peso do mês | ❌ |
| Planilha1/2, DIM, CONTABILIZAÇÃO | — | Pivots e conferência | ❌ (pivot) |

### Graficos Tendência.xlsx — 14 abas

| Aba | Linhas | Conteúdo | Uso hoje |
|---|---:|---|---|
| **TMR - Flexo / R18 / R20 / Roto / Laminação / L04 / Corte** | 18–22 cada | Setup, Inicialização, Improdutivo, Inativo, Produzindo, Disponibilidade | ❌ |
| Dados Prod | 23 | Volume, lote médio, aparas, vazão (blocos lado a lado) | ⚠️ mapeada mas **quebrada** |
| Volume (km) / Volume (ton) / Scrap | 20–25 | Séries mensais por processo e por máquina | ❌ |
| Borra de Tinta / Borra de Adesivo | 27 / 39 | Produzido × descarte mensal | ❌ |
| Lote Médio | 17 | km por mês | ❌ |

> A tabela `tendencia_mensal` está **vazia (0 linhas)** no Supabase: o mapeamento
> aponta para a aba "Dados Prod", mas o cabeçalho dela não é uma linha de colunas
> nomeadas — são cinco blocos lado a lado. Nenhuma coluna casou, e a carga
> descartou tudo em silêncio.

## Domínios de dado que existem mas o painel não cobre

| Domínio | Onde está | Situação |
|---|---|---|
| **Pessoas / RH** | Machine Card: Absenteísmo, MOD, MOI, MO_RATEIO | Nenhum uso |
| **Cliente / comercial** | Base Aparas: BASE_PROD; Aderência: DtEntrega | Nenhum uso |
| **Metas** | Indicadores: Metas + Dinamica; Refugo Aparas: Limite_Fardo | Nenhum uso |
| **Produtividade m²** | Machine Card: Produção (Metros); Refugo Produção: G_m² | Nenhum uso — é por isso que o KPI de produtividade aparece vazio |
| **Programação / aderência** | Aderência Semanal (19 abas) | Nenhum uso |
| **Qualidade / divergência** | Refugo Produção: Formulário - Controle Perdas | Nenhum uso |
| **Cadastros (domínio)** | Classificação, TIPO REFUGO, Base SKU, Engenharia | Nenhum uso |
