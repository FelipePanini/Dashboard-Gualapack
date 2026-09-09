# Relatório de campos

Campos encontrados por base, granularidade real e chave candidata.
Nenhuma chave foi assumida sem olhar o dado — onde não deu para confirmar,
está marcado como **a confirmar**.

## Convenção

- **Granularidade**: o que representa 1 linha.
- **Chave candidata**: combinação que *parece* identificar a linha.
- **Confirmada?**: se foi verificada contra o dado real ou não.

## Bases de evento (log — sem chave natural)

### `apontamentos` ← Base Máquina_Embalagem (Indicadores Diário)
**Granularidade:** 1 evento de máquina (parada, setup, produção).
**Chave candidata:** nenhuma. `NumOrdem + CodRecurso + HoraInicio` chega perto,
mas há linhas com hora de início igual à de fim (evento de refugo, duração zero).
**Confirmada?** Não — hoje usa troca-por-arquivo (`_source_file`), que não exige chave.

| Campo | Tipo | Observação |
|---|---|---|
| num_ordem | texto | OP |
| cod_recurso | texto | máquina; casa com `maquinas.id` |
| cod_apont | texto | **vem zero-padded ("01")** — casa com `ClassificaçãoOficial`, não com `Classificação` |
| cod_desc | texto | "01 - Setup" |
| dt_producao | data | |
| hora_inicio / hora_fim | timestamp | |
| qtd_horas | número | fração de hora (0.0667 = 4 min) |
| qtd_produzida | número | metros |
| turno | texto | 1, 2, 3 |
| peso_bruto_bobina | número | `usr_PesoBrutoBobina` |
| tipo_perda | texto | `usr_tipodaperda` — ex: `08_Refile` |
| kg_perda | número | `usr_kgdaperda` |
| nome_operador, descricao, tipo_produto, cod_estrutura, des_num_ordem, cod_est, processo, classificacao, nome_cliente | texto | |

### `producao_kg` ← Base Apontamentos (kg)
**Granularidade:** 1 linha por OP × recurso × dia × turno.
**Chave candidata:** `NumOrdem + CodRecurso + DtProducao + Turno`.
**Confirmada?** Não. A planilha traz uma coluna `CHAVE` própria (ex: `20255` =
ano+mês) que **não é única** — é chave de período, não de linha.

### `refugo_producao` ← Consulta Perda
**Granularidade:** 1 evento de refugo.
**Chave candidata:** nenhuma; tem `Chave 1` que também é ano+mês.
**Confirmada?** Não — usa troca-por-arquivo.

### `fardos_aparas` ← COMPLETOS
**Granularidade:** 1 fardo.
**Chave candidata:** `DATA + Nº` (número do fardo dentro do mês).
**Confirmada?** Não — o campo `Nº` aparece como "-" em várias linhas
(fardos sem numeração), então a chave falharia nessas.

## Bases de série temporal (têm chave natural)

### `refugo_aparas_historico` ← Conta Refugo
**Granularidade:** 1 mês.
**Chave:** `data`. ✅ **Confirmada** — é o `onConflict` em uso hoje e funciona.

⚠️ **Colunas não lidas hoje** (10 de 15): `VOLUME TOTAL`, `SCRAP TOTAL`,
`% JGR`, `% OF`, `% GUALAPACK`, `SCRAP (S/ Refile)`.

⚠️ **Dado futuro:** a série vai até **2026-12-01** (3 meses à frente de hoje) —
são linhas de projeção. Hoje elas entram no banco como se fossem realizado.

### `tendencia_mensal` ← Dados Prod
**Granularidade:** 1 mês.
**Chave:** `mes + ano`. ✅ Confirmada no schema, mas **a tabela está vazia** —
o cabeçalho da aba não casa (ver `INVENTARIO_BASES.md`).

## Cadastros (chave própria)

### `maquinas` ← DIM_EQTOS & GRUPO EQTO
**Granularidade:** 1 recurso.
**Chave:** `id` (Type of Machine). ✅ Confirmada.

⚠️ 35 linhas na planilha viram **21 no banco** após deduplicação, e entre elas
há entradas que **não são máquina física**: `GERAL` (grupo "SUPERVISOR DE
PRODUÇÃO"), `IMPRESSORAS` ("CASA DE TINTA"), `FLEXOGRAFIA` ("LIMPEZA DE PEÇA"),
`LAMINADORAS` ("PRODUÇÃO ADESIVO"), `ROTOGRAVURA` ("CILINDROS"). São categorias
administrativas. A view `v_maquinas_resumo` já filtra por grupo físico, então o
painel não é afetado — mas a tabela crua mistura os dois conceitos.

### `DB_MOTIVOS_APARAS` ← CLASSIFICAÇÃO (Sequenciamento)
**Granularidade:** 1 código.
**Chave:** `codigo`. ⚠️ **O cadastro não é estável entre meses**: fevereiro tem
12 linhas, março 13, setembro 10. O mesmo código pode significar coisas
diferentes em meses diferentes — a confirmar.

### `Classificação` / `ClassificaçãoOficial` ← Indicadores Diário
**Granularidade:** 1 código de apontamento (112 linhas).
**Chave:** `COD`. ✅ Estrutura clara.

| Campo | Valores |
|---|---|
| COD | "01".."112" (Oficial) ou "1".."112" (a outra) |
| DESCRIÇÃO | "Setup", "ACERTO de Cores", "Refeição Autorizada"… |
| CLASSIFICAÇÃO DISP. | IMPRODUTIVO / PLANEJADO / … |
| CLASSIFICAÇÃO | SETUP / INICIALIZAÇÃO / INATIVIDADE / … |

> **Esta é a tabela que liga o apontamento à categoria de TMR.** Hoje o painel
> deduz isso de `cod_apont = '20'` no SQL, em vez de usar o cadastro oficial.

### `DB_SKU` ← Base SKU
**Granularidade:** 1 SKU. **Chave:** `Código PA`. A confirmar se é única
(a aba tem 2 colunas úteis mas o range diz 11 colunas — pode ter blocos extras).

### `DB_ENGENHARIA` ← Engenharia
**Granularidade:** 1 ordem/estrutura.
**Chave candidata:** `NumOrdem` ou `CodEstrutura`. **A confirmar** — a mesma
estrutura aparece em várias ordens, então provavelmente a chave é `CodEstrutura`
e `NumOrdem` é a ordem que a gerou.

| Campo | Uso potencial |
|---|---|
| Passo, Largura, **LARGURA REAL** | cálculo de m² |
| HorizFaixa, VertRepet | número de faixas/repetições |
| Cilindro | ferramental |
| CodSAP, CodCliente, NomeCliente | ligação comercial |

## Bases novas com chave provável

### `DB_TMR` ← abas TMR-* (Graficos Tendência)
**Granularidade:** 1 recurso × mês.
**Chave candidata:** `recurso + mes`. ✅ Consistente nas 7 abas (13–16 meses cada).

| Campo | Tipo | Observação |
|---|---|---|
| recurso | texto | do **nome da aba** (R18, L04, Flexo…) |
| recurso_rotulo | texto | rótulo interno da aba — ⚠️ "TMR - L04" diz "Laminação" internamente, igual à aba do processo; por isso o nome da aba é a fonte confiável |
| granularidade | texto | `maquina` (R18, R20, L04) ou `processo` (Flexo, Roto, Laminação, Corte) |
| mes | texto | "Janeiro", "Fevereiro"… ⚠️ sem ano na planilha |
| setup_pct, inicializacao_pct, improdutivo_pct, inativo_pct, produzindo_pct, disponibilidade_pct | número | em pontos percentuais |
| horas_totais | número | ⚠️ vem vazio em várias abas |

⚠️ **Laminação, L04 e Corte não têm a coluna `Inicialização`** — as outras quatro têm.
⚠️ **`mes` não tem ano.** Como as abas têm 13–16 linhas, há mais de 12 meses:
provavelmente incluem "YTD" ou viram o ano. **A confirmar antes de usar.**

### `DB_PRODUCAO_DIARIA` ← Produção (Refugo Aparas)
**Granularidade:** 1 dia × segmento.
**Chave candidata:** `DATE + SEGMENT I + SEGMENT II`. A confirmar.

### `DB_REFUGO_DIARIO_JGR` / `_OF`
**Granularidade:** 1 dia por planta.
**Chave candidata:** `DATE`. Provável, mas há linhas com valor 0 em todas as
colunas (dias sem produção) — a confirmar se são duplicadas.

### `DB_METAS` ← Metas (Indicadores Diário)
**Granularidade:** 1 dia × máquina.
**Chave candidata:** `DATA + MÁQUINA`. Muito provável (3.668 linhas ≈ 
21 máquinas × ~175 dias).

### `DB_ADERENCIA_DIARIA` ← ADERÊNCIA DIÁRIA
**Granularidade:** 1 OP × máquina × data planejada.
**Chave candidata:** `NumOrdem + Máquina + DtIniPlan`.
**Confirmada?** ❌ **Não** — é a pendência mais antiga deste mapeamento.
Precisa de uma contagem `count(*)` vs `count(distinct ...)` no dado real.

## Padronização de valores

Casos onde o mesmo conceito aparece escrito de formas diferentes:

| Conceito | Variações observadas | Onde |
|---|---|---|
| Máquina | `REB 01` / `REB01`, `HMC01` / `HMC 01` | `maquinas` vs demais bases |
| Código de apontamento | `1` vs `01` | Classificação vs ClassificaçãoOficial |
| Nome de aba (mesmo template) | `DETALHES` vs `DETALHES - FP` | Sequenciamento fev/mar vs set |
| Mesma base, nomes diferentes | `Base Produção` / `BASE_MÁQ_EMB` / `BASE_DETALHE` | Base Aparas |
| Planta | `JGR` / `Plant JGR` / `ORF` / `OF` | Refugo Aparas |

A camada `DB_` deve guardar **valor original e valor padronizado**, para não
perder a rastreabilidade. Isso ainda **não está implementado** — hoje só existe
`HEADER_ALIASES` para nome de coluna, não para valor de célula.
