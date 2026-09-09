# Relatório de redundâncias e sobreposições

Levantado em 2026-09-09. **Nada foi eliminado** — este documento apenas
classifica o que se sobrepõe, para decidirmos depois com base em fato.

## 1. A maior sobreposição: o evento de máquina aparece em 8 lugares

Oito abas, em quatro arquivos diferentes, carregam **o mesmo tipo de registro**
(1 linha = 1 evento de máquina: OP, recurso, código de apontamento, início, fim,
horas, turno, perda).

| Arquivo | Aba | Linhas | Colunas | Diferença |
|---|---|---:|---:|---|
| Indicadores Diário 2025 | **Base Apontamento** | 379.792 | 25 | **+ CLASSIFICAÇÃO DISP., CLASSIFICAÇÃO HORAS, CHAVE** |
| Indicadores Diário 2025 | Base Máquina_Embalagem | 170.099 | 22 | ✅ é a que usamos |
| Base Aparas 2024 | Base Produção | 389.435 | 22 | — |
| Base Aparas 2025 | Base Produção | 367.520 | 22 | — |
| Base Aparas 2024 | BASE_MÁQ_EMB | 168.329 | 22 | — |
| Base Aparas 2025 | BASE_MÁQ_EMB | 168.835 | 22 | — |
| Base Aparas 2025 | BASE_DETALHE | 22.647 | 22 | ✅ também usada |
| Machine Card 2025 | Horas | 416.529 | 17 | subconjunto de colunas |

**Campos idênticos:** NumOrdem, CodRecurso, CodApont, Cod_Desc, DtProducao,
HoraInicio, HoraFim, QtdHoras, QtdProduzida, Turno, usr_PesoBrutoBobina,
usr_tipodaperda, usr_kgdaperda, NomeOperador, Descricao, TipoProduto,
CodEstrutura, Des_NumOrdem, CodEst, Processo, Classificacao, NomeCliente.

**Diferença que importa:** `Base Apontamento` (a maior, 379k linhas) tem três
colunas a mais, e uma delas — `CLASSIFICAÇÃO DISP.` — já traz o evento
classificado em IMPRODUTIVO / PLANEJADO / PRODUZINDO. É exatamente a
categoria que o cálculo de TMR precisa, e hoje ela é recalculada no banco a
partir do código de apontamento.

**Perguntas a responder antes de decidir:**
1. `Base Apontamento` e `Base Máquina_Embalagem` cobrem o mesmo período, ou uma
   é histórico e a outra é o mês corrente?
2. As três colunas extras são confiáveis (preenchidas em todas as linhas)?
3. `Base Produção` nos Base Aparas é a mesma coisa com outro nome, ou tem
   critério de filtro diferente?

**Classificação provisória:** uma delas é PRINCIPAL, as outras são REDUNDANTES —
mas ainda **não dá para dizer qual** sem comparar os períodos.

## 2. Cadastro de engenharia repetido em 4 arquivos

| Arquivo | Aba | Linhas | Colunas |
|---|---|---:|---:|
| Aderência Semanal | Engenharia | 44.875 | 15 (**+ LARGURA REAL**) |
| Base Aparas 2026 | Engenharia | 43.438 | 14 |
| Indicadores Diário 2025 | Engenharia | 43.060 | 14 |
| Base Aparas 2025 | Engenharia | 43.031 | 14 |
| Base Aparas 2024 | Engenharia | 41.706 | 14 |
| Refugo Produção | Larguras | 43.331 | 13 (+ largura real) |

Mesmo cadastro (NumOrdem, CodEstrutura, Descricao, CodItem, Passo, Largura,
NomeCliente, CodCliente, CodSAP, TipoProduto, HorizFaixa, VertRepet, Cilindro,
DataEmissao), com contagens que crescem com o ano do arquivo — ou seja, são
**fotos do mesmo cadastro em datas diferentes**.

A versão da Aderência Semanal tem uma coluna a mais (LARGURA REAL) que as outras
não têm, e é a mais recente. **Candidata natural a fonte única**, a confirmar.

## 3. Série mensal de refugo de aparas: 5 recortes da mesma coisa

Dentro de `Refugo Aparas.xlsx`:

| Aba | Linhas | Colunas | Sobreposição |
|---|---:|---:|---|
| Conta Refugo | 66 | 15 | ✅ a que usamos (só 5 col lidas) |
| Master Plan | 63 | 16 | Conta Refugo + REFILE JGR + RODA CARROÇA + % REFILE |
| Histórico Refugo | 37 | 7 | Subconjunto + YTD |
| Refugo_Separado | 97 | 4 | Mesmo dado em formato longo (planta vira linha) |
| Limite_Fardo | 25 | 11 | Mesma série + limite/meta de descarte |

Todas partem de VOLUME/SCRAP por planta e mês. Diferem só em recorte e em
colunas derivadas. **Master Plan parece a mais completa** (tem refile e roda de
carroça, que as outras não têm).

## 4. Cópias literais dentro do mesmo arquivo

| Arquivo | Abas | Situação |
|---|---|---|
| Base Aparas 2025 | `Planilha5` e `Planilha5 (2)` | 4.869 linhas **idênticas** nas duas |
| Machine Card Genérico | `D_PRODUTIVIDADE`, `(2)` e `(3)` | 71 linhas cada, mesmo layout |
| Machine Card 2025 | `D_MasterPlan` e `D_MasterPlan (2)` | 56 linhas cada |
| Machine Card Genérico | `MACHINE CARD` e `MACHINE CARD (2)` | 503 e 545 linhas |
| Indicadores Diário | `Classificação` e `ClassificaçãoOficial` | 112 linhas cada; diferem só no código ser "1" ou "01" |
| Refugo Produção | `Formulário - Controle Perdas` e `Backup` | 367 e 145 linhas, mesmas 15 colunas |
| Aderência Semanal | `Semanas` e `Tabela Semana` | 427 linhas cada, DATA→SEMANA |
| Aderência Semanal | `Base OP Faturamento` e `Backup` | 208 e 283 linhas, mesmas 6 colunas |

São rascunhos e backups manuais. Baixo risco em descartar, mas **não descartei** —
só registrei.

> ⚠️ `Classificação` vs `ClassificaçãoOficial`: a diferença de "1" para "01" é
> exatamente o tipo de coisa que quebra um relacionamento silenciosamente.
> O `CodApont` nas bases de evento vem zero-padded ("01"), então a versão
> **Oficial** é a que casa.

## 5. Fardo a fardo: COMPLETOS vs Detalhes1

Dentro de cada Sequenciamento mensal:

| Aba | Linhas (set/26) | Colunas |
|---|---:|---|
| COMPLETOS | 467 | 11 — ✅ usada |
| Detalhes1 | 492 | 11 — mesmas colunas |

Mesmas colunas, contagens próximas. `Detalhes1` é o drill-down da tabela
dinâmica e traz a **descrição** da classificação (ex: "PROCESSO PRODUTIVO"),
enquanto `COMPLETOS` traz o código. Diferença pequena, mas real.

**Pergunta:** as 25 linhas a mais em Detalhes1 são registros que faltam em
COMPLETOS, ou linhas de outro período que entraram no pivot?

## 6. Aderência: duas granularidades, não redundância

| Aba | Linhas | Granularidade |
|---|---:|---|
| ADERÊNCIA DIÁRIA | 15.550 | OP × máquina × dia planejado |
| ADERÊNCIA SEMANAL | 6.694 | OP × máquina × semana |
| Programação | 718 | OP × máquina (programação vigente) |
| Produção Antiga | 113.394 | evento de máquina, formato antigo (19 col) |

As duas primeiras **não são redundantes entre si** — são níveis diferentes.
`Produção Antiga` é claramente LEGADA (formato com menos colunas que o atual).

## 7. Sequenciamento mensal vs "Sequenciamento Acumulado 2026"

O arquivo `Sequenciamento Acumulado 2026.xlsx` contribuiu com **1.724 linhas**
para `fardos_aparas`, além das ~420/mês dos 9 arquivos mensais (3.786 no total).

1.724 ≈ 4 meses de fardos. **Precisa de confirmação:** é um acumulado que
repete o que já vem dos mensais (e então estamos contando fardo duas vezes),
ou é um período que os mensais não cobrem?

> Este é o único item deste relatório que pode estar **afetando número no painel
> hoje**. Os outros são dado não usado.

## Resumo por classificação

| Classificação | Quantas bases | Exemplos |
|---|---:|---|
| PRINCIPAL | 8 | Base Apontamento, BASE_PROD, Produção (Metros), ADERÊNCIA DIÁRIA, TMR-* |
| COMPLEMENTAR | 9 | Borra, Limite_Fardo, Formulário Controle Perdas, Absenteísmo |
| REDUNDANTE | 12 | Base Produção, BASE_MÁQ_EMB, Histórico Refugo, Detalhes1, cópias |
| LEGADA | 3 | Produção Antiga, Backup (×2) |
| AUXILIAR | 6 | Classificação, TIPO REFUGO, Base SKU, Engenharia, Semanas, LocalCorreto_Maq |
| INCERTA | 4 | Sequenciamento Acumulado, MACHINE CARD, Modelo Diário, DtEntrega |
