# Estrutura extraída dos BIs de Produção — Gualapack Jaguariúna

Levantamento feito a partir dos 5 arquivos `.pbix` fornecidos. **Os arquivos não foram
alterados** — apenas lidos para mapear indicadores, dimensões e valores de domínio.

> Nota sobre "dados reais": o modelo de dados dentro do `.pbix` é comprimido com XPress9
> (formato proprietário Microsoft), então **os valores numéricos não puderam ser extraídos**.
> O que passou a ser real no painel é toda a **estrutura**: nomes de indicadores, máquinas,
> tipos de perda, status de apontamento, classificações e cores oficiais. Os números seguem
> como referência até a conexão com a fonte de dados (ver "Próximo passo" no final).

---

## 1. Arquivos analisados

| Arquivo | Tema | Páginas |
|---|---|---|
| `Indicadores_de_Produção.pbix` | BI gerencial principal | 25 páginas — Aparas, Estratificação, Vazões, Aderência, Produtividade, TMR, Velocidade |
| `Dados_Produção.pbix` | Operacional | Gerencial, Produção, Refugo, Horas, Velocidades |
| `Perda_Estratificada.pbix` | Refugo detalhado | Refugo estratificado por OP/máquina/tipo |
| `Linha_do_Tempo_Gualapack.pbix` | Gantt de apontamentos | Linha do Tempo, Aderência ao Planejado, Pareto |
| `Análise_Carteira_x_Produção.pbix` | Planejamento | Carteira x Produção, WIP |

---

## 2. Indicadores (medidas reais)

### Aparas / Refugo — indicador principal
- `% Apontada_Geral REBS` — apara **apontada** pelo operador
- `% PerdaConfirm. TOTAL` / `% PerdaConfirm. JGR` — apara **confirmada** (balança)
- `% Diferença Aparas` — aderência entre apontado e confirmado
- `% PerdaConfirm. JGR Sem Refile` — perda descontando refile
- `% Apontada_Geral REBS Intercompany`
- `Peso Bruto REBs`, `KG_Perda`, `Refugo Acerto`

### Produtividade / Eficiência
- `TMR` — Tempo de Máquina Rodando (%) = Horas Produzindo ÷ Horas Totais
- `M² por Hora Trabalhada` — produtividade (m²/h)
- `VelMédia` (m/min), `VazãoMédia` (m/min)
- `Horas Produzindo`, `Horas Totais`, `Horas Totais Trabalhadas`

### Aderência ao Planejado
- `Planejado` / `Realizado` (Km lineares), `Realizado KG`
- `% Aderência`, `GAP Realizado`, `GAP Kg`
- Por processo: `% IMPRESSAO`, `% LAMINAÇAO`, `% CORTE`, `% Ad OP`, `% Realizado Prog`

### Carteira / WIP
- `QTD ENTREGA KG` (carteira), `Peso Bruto` (produzido), `FaturamentoKg`
- `Metros WIP`, `Metros_Somente_Impressos`, `Metros WIP Intermediario`,
  `Metros_Somente_Fungicida`, `Metros Papel`, `Falta Carteira`

---

## 3. Dimensões e valores de domínio

### Máquinas — ordem oficial (do eixo do Gantt no BI Linha do Tempo)
```
COATING 01 │ R12  R18  R20  RT01 │ L02  L03  L04 │ REB 01  REB 04  REB 05  REB 09  REB 10
 Coating   │      Impressão      │   Laminação   │            Corte / Refile
```
Agrupamentos usados no BI: `GRUPO 1` … `GRUPO 4` (campo `Grupo Máquinas`).

### Status de apontamento — com as cores oficiais do BI
| Status | Cor |
|---|---|
| Produzindo | `#2E7D32` |
| Parada Produtiva | `#C62828` |
| Fim de Turno | `#BDBDBD` |
| Setup | `#CD853F` |
| Acerto de Cores | `#FFA500` |
| Logística | `#00BFFF` |
| PCP | `#9400D3` |
| Manutenção | `#000000` |
| Refeição Autorizada | `#FA8072` |
| Informar Parada | `#FFFF00` |
| Casa de Tintas | `#000080` |

### Tipos de perda (`usr_tipodaperda`)
`01_Falha_Impressao` · `02_Acerto_Maquina` · `03_Cor_Fora_do_Padrao` · `04_Marcas_de_Emenda` ·
`05_Acerto_de_Cor` · `06_Falha_de_Laminacao` · `08_Refile` · `09_Roda_de_Carroca` · `10_Manta` ·
`11_Capa` · `12_Falha_de_Fungicida` · `15_Ajuste_de_Maquina` · `16_Borra_Extrusora` ·
`18_Material_Acerto` · `19_Movimentacao_MP`

### Classificação de produto
`Sylvamo Bopp & Paper` · `Soap Wrappen and Multipack` · `Simple Laminated` ·
`Bula & Paper` · `Bi/Tri Laminated`

### Rota de impressão
`FLEXO` · `ROTO` · `SEM IMPRESSÃO`

### Processos (rota de produção)
`Impressão` · `Laminação` · `Corte` · `Refile` · `OF`

### Etapas de WIP
`IMPRESSO` · `WIP INTERMEDIÁRIO` · `CORTE` · `PAPEL` · `PRE CORTE` · `FINAL`
Sufixos: `DC` (Dentro da Carteira) / `FC` (Fora da Carteira)

### Unidades / origem
`GPK JGR` (Jaguariúna) · `GPK IPERÓ` · `OF` · `INTERCOMPANY`

---

## 4. Mapeamento BI → páginas do painel

| Página do painel | Origem no BI |
|---|---|
| Visão Geral | KPIs de `Indicadores de Produção` (Aparas, TMR, Produtividade, Aderência) |
| Aparas & Refugo | `Perda Estratificada` + páginas Estratificação do `Indicadores` |
| Produtividade & TMR | páginas Produtividade / TMR / Velocidade do `Indicadores` |
| Aderência | `Ad. Plan Mensal/Semanal/Diária` + `Linha do Tempo` (Aderência ao Planejado) |
| Linha do Tempo | Gantt de apontamentos do `Linha do Tempo` |
| WIP & Carteira | `Análise Carteira x Produção` |

---

## 5. Próximo passo — ligar aos dados reais

Os números do painel continuarão sendo de referência até existir uma fonte que o navegador
consiga ler. Três caminhos, do mais simples ao mais robusto:

1. **Exportação agendada (mais rápido)** — cada BI exporta um CSV/JSON para uma pasta do
   SharePoint; uma rotina diária publica esse arquivo e o painel lê direto. Não exige
   licença nova.
2. **Semantic model via API** — consultar o dataset publicado no Power BI Service pela
   API REST (`executeQueries` com DAX). Exige licença Pro/PPU e um app registrado no Entra ID.
3. **Direto na origem** — replicar as tabelas base (`Base_Apontamentos`, `BASE_PROD`,
   `Aparas_Processo`, `ADERENCIA_BI`) para o Supabase que já está no projeto, alimentado por
   uma carga agendada. É o que dá mais controle e o que melhor aproveita a autenticação
   que já existe.
