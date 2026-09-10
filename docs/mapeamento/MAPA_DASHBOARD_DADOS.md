# Mapa Dashboard × Dados

Levantado em 2026-09-10 lendo `demo/index.html` (2.789 linhas) componente a
componente e validando cada número contra o Supabase.

**Nada foi alterado.** Este documento é diagnóstico.

## Legenda de status

| | Significado |
|---|---|
| ✅ | Correto: fonte certa, número validado |
| 🟡 | Dado existe, mas precisa ajuste |
| 🔴 | Sem fonte, ou número visivelmente errado |
| ⚠️ | Cálculo precisa ser validado com quem conhece o processo |

## Visão geral do fluxo real

```
6 abas · 19 painéis · 25 componentes alimentados por dados
        ↑
10 views do Supabase  (o dashboard só lê view, nunca tabela — isso está correto)
        ↑
9 tabelas
        ↑
DATABASE_GUALAPACK.xlsx  (7 abas DB_ ligadas + 25 abas de inventário)
        ↑
21 arquivos no Drive
```

---

## Tabela de mapeamento

### Aba: Visão Geral

| Componente | Campo/KPI | Fonte DB | Tabela | View | Status | Validado |
|---|---|---|---|---|---|---|
| KPI Apara apontada | % | DB_FARDOS_APARAS | fardos_aparas | v_fardos_mensal | 🔴 mostra **0,0%** | SIM |
| KPI TMR médio | % | DB_APONTAMENTOS | apontamentos | v_maquinas_resumo | 🔴 11 de 16 máquinas em 0% | SIM |
| KPI Produtividade | m²/h | — | — | — | 🔴 sem fonte (KPI é ocultado) | SIM |
| KPI Aderência ao plano | % | — | aderencia_programacao | v_maquinas_resumo | 🔴 fonte morta, unidade errada | SIM |
| Gráfico Aparas GPK (apontado × confirmado) | % mensal | DB_FARDOS_APARAS + DB_REFUGO_APARAS | fardos_aparas + refugo_aparas_historico | v_fardos_mensal + v_refugo_mensal | 🔴 4 meses futuros + escala fixa | SIM |
| Perda por motivo | kg | DB_APONTAMENTOS | apontamentos | v_perda_por_motivo | ✅ 20 motivos, 1.110.784 kg | SIM |
| Cards de máquina (grid) | TMR, apara | DB_APONTAMENTOS | apontamentos | v_maquinas_resumo | 🟡 16 cards, 11 sem dado de TMR | SIM |
| Sparkline de todos os KPIs | série | **nenhuma** | — | — | 🔴 `Math.random()` | SIM |

### Aba: Aparas & Refugo

| Componente | Campo/KPI | Fonte DB | Tabela | View | Status | Validado |
|---|---|---|---|---|---|---|
| KPI Refugo total | t | DB_APONTAMENTOS | apontamentos | v_perda_por_motivo | ✅ 1.110 t | SIM |
| KPI Apara apontada / confirmada / diferença | % | idem visão geral | idem | idem | 🔴 herda o mesmo 0,0% | SIM |
| Perda por motivo (kg) | kg | DB_APONTAMENTOS | apontamentos | v_perda_por_motivo | ✅ | SIM |
| Perda por máquina (kg) | kg | DB_APONTAMENTOS | apontamentos | v_maquinas_resumo | ✅ | SIM |
| Apara por classificação | % | DB_APONTAMENTOS | apontamentos | v_perda_por_classificacao | ✅ 12 classificações | SIM |
| Refugo por máquina (Produção) | kg | DB_REFUGO_PRODUCAO | refugo_producao | v_refugo_producao_maquina | ✅ | SIM |
| Produção mensal (kg) | kg | DB_PRODUCAO_KG | producao_kg | v_producao_kg_mensal | ✅ | SIM |
| Ordens com maior refugo | tabela | DB_APONTAMENTOS | apontamentos | v_ops_refugo | ✅ 50 OPs | SIM |

### Aba: Produtividade & TMR

| Componente | Campo/KPI | Fonte DB | Tabela | View | Status | Validado |
|---|---|---|---|---|---|---|
| KPI TMR médio | % | DB_APONTAMENTOS | apontamentos | v_maquinas_resumo | 🔴 mesma causa | SIM |
| KPI Produtividade | m²/h | — | — | — | 🔴 sem fonte | SIM |
| KPI Velocidade média | m/min | — | — | — | 🔴 sem fonte | SIM |
| KPI Horas produzindo | h | DB_APONTAMENTOS | apontamentos | v_maquinas_resumo | 🟡 só 5 máquinas contribuem | SIM |
| TMR por máquina | % | DB_APONTAMENTOS | apontamentos | v_maquinas_resumo | 🔴 11 barras em 0% | SIM |
| Horas por classificação de parada | h | DB_APONTAMENTOS | apontamentos | v_downtime_por_status | ✅ 36 status, 30.102 h | SIM |
| Velocidade média por máquina | m/min | — | — | — | 🔴 mostra estado vazio | SIM |

### Aba: Aderência

| Componente | Campo/KPI | Fonte DB | Tabela | View | Status | Validado |
|---|---|---|---|---|---|---|
| KPI Aderência ao plano | % | — | aderencia_programacao | v_maquinas_resumo | 🔴 fonte morta | SIM |
| KPI Planejado / Realizado / GAP | km | — | aderencia_programacao | v_maquinas_resumo | 🔴 12,3 **bilhões** de km | SIM |
| Planejado × Realizado por máquina | km | — | aderencia_programacao | v_maquinas_resumo | 🔴 idem | SIM |
| Aderência por processo | % | — | aderencia_programacao | v_maquinas_resumo | 🔴 idem | SIM |

### Aba: Linha do tempo

| Componente | Campo/KPI | Fonte DB | Tabela | View | Status | Validado |
|---|---|---|---|---|---|---|
| Gantt de apontamentos | segmentos | DB_APONTAMENTOS | apontamentos | v_apontamentos_ultimo_dia | 🔴 **2 linhas, 2 máquinas** | SIM |
| Pareto de paradas | h + % | DB_APONTAMENTOS | apontamentos | v_downtime_por_status | ✅ | SIM |

### Aba: WIP & Carteira

| Componente | Campo/KPI | Fonte DB | Tabela | View | Status | Validado |
|---|---|---|---|---|---|---|
| KPI WIP total / Dentro da carteira | km, % | **nenhuma** | — | — | 🔴 fixture no código | SIM |
| KPI Carteira do mês | t | DB_APONTAMENTOS | apontamentos | v_perda_por_classificacao | ⚠️ usa peso bruto como "carteira" | SIM |
| KPI Produzido / Faturado | t | **nenhuma** | — | — | 🔴 `carteira × 0,86` e `× 0,79` fixos | SIM |
| WIP por etapa | km | **nenhuma** | — | — | 🔴 fixture | SIM |
| Carteira × Produção | t | parcial | apontamentos | v_perda_por_classificacao | 🔴 2 das 3 séries são fixas | SIM |
| WIP em aberto por cliente | tabela | **nenhuma** | — | — | 🔴 fixture | SIM |

> A aba WIP já exibe um aviso no próprio painel dizendo que é referência.
> Está honesta com o usuário — o problema é que a **aba Aderência não avisa**,
> e os números dela também não são confiáveis.

### Filtros e seletores

| Filtro | Campo | Afeta | Status |
|---|---|---|---|
| Período (14 dias / 7 dias / Este mês) | — | **1 de 25 componentes** (só o gráfico Aparas GPK, e troca janela de *meses*, não de dias) | 🔴 |
| Filtro por processo (chips em Máquinas) | `processo` derivado de `maquinas.grupo` | grid de máquinas | ✅ |
| Tema claro/escuro | — | visual | ✅ |
| "Ao vivo" | — | animação | 🟡 decorativo |

Nenhuma view do Supabase recebe parâmetro de período — todas agregam **todo o
histórico da tabela**. O seletor de período do topo não tem como funcionar de
verdade sem mudar as views.

---

## Os 6 problemas que quebram números hoje

### 1. 🔴 KPI "Apara apontada" mostra 0,0%

**Causa:** o gráfico junta duas séries por mês e pega os últimos 12. `v_refugo_mensal`
tem dado até **dez/2026** (projeção da planilha), `v_fardos_mensal` só até ago/2026.
A janela de 12 meses vira jan→dez/2026, e os 4 meses futuros entram com `apontado = 0`.
O KPI lê o **último** item da série — que é dez/2026 = **0**.

| Mês | Apontado | Confirmado |
|---|---:|---:|
| ago/26 | 6,6% | 18,6% |
| set/26 | *(sem dado → 0)* | 0,0% |
| out–dez/26 | *(sem dado → 0)* | 0,0% |

**Correção:** cortar dado futuro (`data <= current_date`) e fazer o KPI ler o último
mês **com dado**, não o último da série.

### 2. 🔴 TMR: 11 de 16 máquinas aparecem com 0%

**Causa:** a tabela `apontamentos` mistura duas naturezas diferentes de registro:

| Arquivo de origem | Linhas | Horas | Eventos "Produzindo" | Recursos | Tipos de apontamento |
|---|---:|---:|---:|---:|---:|
| Indicadores Diário 2026 | 97.282 | 25.446 | 33.120 | **5** | 37 |
| Indicadores Diário 2025 | 46.084 | 12.725 | 14.073 | **5** | 34 |
| Base Aparas Genérico | 16.175 | 2 | 0 | **16** | **1** |
| Base Aparas 2025 | 5.849 | 1 | 0 | 16 | 1 |
| Base Aparas 2026 | 2.986 | 0 | 0 | 14 | 1 |

A aba `Base Máquina_Embalagem` (Indicadores Diário) tem o log completo — mas só das
**5 rebobinadeiras** (é embalagem). As outras 11 máquinas só existem em `apontamentos`
por causa da `BASE_DETALHE` dos Base Aparas, que tem **um único tipo de apontamento**
(código 40, "Refugo por Operador") e **zero horas**.

Resultado: TMR = horas_produzindo ÷ horas_totais = 0/0 para R18, R20, RT01, L02, L03,
L04, R12, HMC01, COATING 01, REVISORA 01 e REB 03. O painel mostra "0%", que se lê como
"máquina parada" quando na verdade é "sem dado".

**Isso corrige uma conclusão do relatório de redundâncias:** a aba `Base Apontamento`
(379.792 linhas, 25 colunas) **não é redundante** — ela é a base *completa*, cobrindo
todas as máquinas. Estamos usando um recorte de 5 máquinas e tratando como se fosse tudo.

### 3. 🔴 Aderência: fonte morta e unidade errada

`aderencia_programacao` **não está órfã** como reportei antes — tem 75.226 linhas.
Mas:

- vêm de **"Histórico Aderência Programação.xlsx"**, arquivo que **não existe mais**
  na pasta do Drive. O dado está congelado desde a última carga daquele arquivo;
- a data máxima é **2087-11-08** — datas corrompidas;
- `km_planejado` somado dá **12.362.286.418** — 12,3 bilhões de km. Só RT01 tem
  7,4 bilhões. A coluna claramente não está em km, e/ou está somando o que não devia.

Os quatro KPIs e os dois gráficos da aba Aderência saem daí.

### 4. 🔴 Gantt mostra 2 linhas

`v_apontamentos_ultimo_dia` pega o último dia com dado e filtra
`hora_inicio is not null and hora_fim is not null`. No último dia (31/08/2026) sobraram
**2 registros, de 2 máquinas**. O painel de "Linha do tempo" fica praticamente vazio.

### 5. 🔴 Escala do gráfico principal fixa em 3–9%

O gráfico "Aparas GPK" tem `yMin:3, yMax:9` no código. Os valores reais vão de
**6,6% a 26,3%**. A maior parte da série está fora do eixo.

### 6. 🔴 17 sparklines são números aleatórios

A função `wobble()` usa `Math.random()`. Todos os mini-gráficos dos KPIs — TMR,
Produtividade, Aderência, Planejado, Realizado, GAP, WIP, Horas produzindo etc. —
são desenhados com dado inventado. O único sparkline real é o do KPI "Apara apontada"
(usa a série mensal de verdade). Há também um delta fixo no código:
`"+6,2 m²/h vs. mês anterior"`.

---

## Problemas que não quebram número, mas comprometem a leitura

### 7. ⚠️ "Apontado × Confirmado" compara bases diferentes

| Série | Vem de | Denominador |
|---|---|---|
| Apontado | `fardos_aparas` (fardo a fardo) | peso bruto **dos fardos** |
| Confirmado | `refugo_aparas_historico` (mensal por planta) | volume **da planta inteira** |

São dois indicadores diferentes desenhados no mesmo eixo como se fossem o mesmo
medido de dois jeitos. Precisa de validação de quem conhece o processo: a intenção
é comparar operador × balança sobre a **mesma** base?

### 8. 🔴 Duplicação de fardos (já reportado, confirmado)

O "Sequenciamento Acumulado 2026" repete jan–jun/2026 dos arquivos mensais.
1.495 pares (data, nº fardo) presentes nas duas fontes. Infla a série de apara
apontada nesses meses — é o que produz os 24–26% de jan a abr.

### 9. 🟡 Filtro de período praticamente não funciona

Muda 1 de 25 componentes, e mesmo assim troca a janela de meses (6 ou 12), não de dias.

### 10. 🟡 `tendencia_mensal` vazia

Nenhum componente do dashboard consome essa tabela hoje, então não quebra nada —
mas ela é a fonte natural do TMR por processo e das séries de volume/scrap.

---

## Dados que já existem e resolveriam problemas atuais

Tudo abaixo já está consolidado no `DATABASE_GUALAPACK.xlsx` (rodada de 09/09):

| Problema | Base que resolve | Linhas | Onde |
|---|---|---:|---|
| TMR de 11 máquinas | `Base Apontamento` (Indicadores Diário) | 379.792 | ainda não catalogada |
| TMR por máquina/processo | **DB_TMR** | 94 | Graficos Tendência |
| Produtividade m²/h | **DB_PRODUCAO_METROS** | 17.507 | Machine Card |
| Velocidade nominal | `Dinamica` (Indicadores Diário) | 46 | ainda não catalogada |
| Meta por máquina | **DB_METAS** | 3.667 | Indicadores Diário |
| Aderência ao plano | **DB_ADERENCIA_DIARIA** | 15.549 | Aderência Semanal |
| Classificação de parada oficial | **DB_CLASSIFICACAO_APONT** | 222 | Indicadores Diário |

---

## Ordem de correção recomendada

Ordenada por **impacto no número que o usuário vê ÷ risco da mudança**.

### Bloco 1 — números errados na cara do usuário (baixo risco, alto impacto)

1. **Cortar dado futuro** de `refugo_aparas_historico` e fazer o KPI ler o último mês
   com dado. Corrige o "Apara apontada 0,0%". *Uma condição na view.*
2. **Remover a duplicação do Sequenciamento Acumulado.** Corrige a apara de jan–jun.
   *Uma linha no `fileKeywords`.* — **já verificado, aguarda seu aval.**
3. **Ajustar a escala do gráfico principal** de fixa (3–9%) para automática.
   *Duas linhas.*

### Bloco 2 — indicadores sem dado confiável (médio risco)

4. **Trocar a fonte do TMR** para `Base Apontamento` (a base completa, com as 16
   máquinas). Corrige o TMR zerado. Precisa validar antes: período coberto, e se as
   colunas `CLASSIFICAÇÃO DISP.`/`CLASSIFICAÇÃO HORAS` são confiáveis.
5. **Refazer a Aderência** sobre `DB_ADERENCIA_DIARIA`, aposentando
   `aderencia_programacao`. Precisa confirmar a chave e a unidade (metros × km).
6. **Corrigir o Gantt** — investigar por que só 2 registros do último dia têm
   hora de início e fim.

### Bloco 3 — KPIs hoje ocultos (baixo risco, ganho novo)

7. **Ligar Produtividade (m²/h)** com `DB_PRODUCAO_METROS`.
8. **Ligar Velocidade nominal** com a aba `Dinamica`.
9. **Ligar Meta por máquina** com `DB_METAS`.

### Bloco 4 — honestidade visual (baixo risco)

10. **Substituir os 17 sparklines aleatórios** por série real ou por nada.
11. **Avisar na aba Aderência** que os números são de fonte desatualizada, como a
    aba WIP já faz — enquanto o item 5 não estiver pronto.

### Bloco 5 — estrutural (maior risco, deixar por último)

12. **Filtro de período de verdade** — exige parâmetro nas views (ou views por
    período), e toca todos os componentes.
13. **Definir a fonte oficial de "apontado × confirmado"** — decisão de processo,
    não de código.

---

## O que NÃO precisa mudar

- O dashboard já lê **só views**, nunca tabela direta. Está certo.
- Não depende do Drive nem de Excel em runtime. Está certo.
- 8 dos 25 componentes estão ✅ corretos e validados: perda por motivo, perda por
  máquina, apara por classificação, refugo por máquina, produção mensal em kg,
  ordens com maior refugo, horas por classificação de parada, Pareto de paradas.
- Nenhuma tabela ou view nova é necessária para os blocos 1 e 4.
