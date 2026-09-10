# Validação numérica do dashboard

Cada indicador conferido do arquivo original até o número na tela.
Atualizado a cada correção.

Formato: **valor esperado** (o que a fonte diz) × **valor no Supabase** ×
**valor no dashboard**.

---

## Fase 1 — corrigido em 2026-09-10

### A) Apara apontada

| Etapa | Valor |
|---|---|
| Origem | `Sequenciamento (9 mensais)` → aba `COMPLETOS` |
| DB_ | `DB_FARDOS_APARAS` |
| Supabase | `fardos_aparas` — 3.786 linhas, jan–ago/2026 |
| View | `v_fardos_mensal` — 8 meses |
| Dashboard | KPI "Apara apontada" |

**Antes:** 0,0% · **Depois:** 6,58% (ago/2026) · **Status:** ✅

Causa: a série ia até dez/2026 (linhas futuras zeradas da planilha) e o
painel lia o último item. Corrigido em dois pontos — a view corta data futura
e mês sem volume medido; o painel lê o último mês *com* dado.

Série validada mês a mês:

| Mês | bruta_kg | apara % |
|---|---:|---:|
| jan/26 | 71.206 | 24,68% |
| fev/26 | 69.071 | 26,30% |
| mar/26 | 81.892 | 23,05% |
| abr/26 | 80.689 | 25,59% |
| mai/26 | 73.243 | 14,58% |
| jun/26 | 59.699 | 10,95% |
| jul/26 | 65.395 | 8,66% |
| ago/26 | 63.966 | **6,58%** |

### B) Duplicação de fardos

| Etapa | Antes | Depois |
|---|---:|---:|
| Linhas em `fardos_aparas` | 5.510 | **3.786** |
| Arquivos de origem | 10 | **9** (só os mensais) |
| bruta_kg jan/26 | 142.413 | **71.206** |
| apara % jan/26 | 24,68% | **24,68%** |

**Status:** ✅ removido (1.724 linhas do "Sequenciamento Acumulado 2026").

> ⚠️ **Correção de uma conclusão anterior.** Eu havia afirmado que a
> duplicação inflava a apara de jan–jun para ~25% quando o real seria ~7%.
> **Estava errado.** Numerador e denominador dobravam juntos, então o
> percentual nunca mudou. O que estava dobrado era o volume em kg — que o
> dashboard não exibe. O degrau de 25% (abr) para 6,6% (ago) é **real**.

Por que não deduplicar por chave: 2.125 das 5.510 linhas (39%) não têm
número de fardo. `(data, nº)` colapsaria a tabela para 2.098 linhas,
destruindo dado legítimo.

### C) Escala do gráfico Aparas GPK

**Antes:** fixa em 3–9%, com dados reais de 6,6% a 26,3% (maior parte fora
do eixo). **Depois:** automática, ignorando meses sem dado no cálculo.
**Status:** ✅

Junto: meses sem medição deixaram de virar 0. Agora a linha **quebra** no
buraco (as duas séries cobrem períodos diferentes) e o tooltip mostra
"sem dados". Validado com fixture proposital onde `v_refugo_mensal` tem
abr/mai e `v_fardos_mensal` não.

---

## Em validação

### D) TMR — troca de fonte

**Problema:** 11 das 16 máquinas mostram 0%.

| Origem em `apontamentos` | Linhas | Horas | Ev. produzindo | Recursos | Tipos de apont. |
|---|---:|---:|---:|---:|---:|
| Indicadores Diário 2026 | 97.282 | 25.446 | 33.120 | 5 | 37 |
| Indicadores Diário 2025 | 46.084 | 12.725 | 14.073 | 5 | 34 |
| Base Aparas Genérico | 16.175 | 2 | 0 | 16 | 1 |
| Base Aparas 2025 | 5.849 | 1 | 0 | 16 | 1 |
| Base Aparas 2026 | 2.986 | 0 | 0 | 14 | 1 |

A aba `Base Máquina_Embalagem` cobre só as 5 rebobinadeiras; as outras 11
máquinas entram apenas via `BASE_DETALHE`, que tem um único código de
apontamento (refugo) e zero horas.

**Hipótese a validar:** a aba `Base Apontamento` (379.792 linhas, 25 colunas)
é a base completa. Rodando `validar-base-apontamento.js` para conferir
período, máquinas, horas, eventos produzindo e classificação antes de trocar.

**Status:** ⏳ validação em andamento.

---

## Ainda não validado

| Indicador | Status | Bloqueio |
|---|---|---|
| Aderência ao plano | 🔴 | fonte morta (arquivo fora da pasta, datas até 2087, 12,3 bi de "km") |
| Gantt | 🔴 | 2 registros no último dia |
| Produtividade m²/h | 🔴 | falta ligar `DB_PRODUCAO_METROS` |
| Velocidade nominal | 🔴 | falta ligar aba `Dinamica` |
| Metas por máquina | 🔴 | falta ligar `DB_METAS` |
| 17 sparklines | 🔴 | `Math.random()` |
| Filtro de período | 🟡 | afeta 1 de 25 componentes |
| WIP / Carteira (5 componentes) | 🔴 | fixtures no código |

---

## Já corretos (validados no mapeamento)

| Indicador | View | Valor conferido |
|---|---|---|
| Perda por motivo | `v_perda_por_motivo` | 20 motivos · 1.110.784 kg |
| Perda por máquina | `v_maquinas_resumo` | 16 máquinas |
| Apara por classificação | `v_perda_por_classificacao` | 12 classificações |
| Refugo por máquina | `v_refugo_producao_maquina` | ok |
| Produção mensal (kg) | `v_producao_kg_mensal` | ok |
| Ordens com maior refugo | `v_ops_refugo` | 50 OPs |
| Horas por classificação de parada | `v_downtime_por_status` | 36 status · 30.102 h |
| Pareto de paradas | `v_downtime_por_status` | ok |
