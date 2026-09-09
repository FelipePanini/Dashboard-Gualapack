# Bases candidatas a descontinuação

**Nada aqui é decisão.** São hipóteses com o grau de confiança de cada uma,
para você decidir depois. Nenhuma base foi desligada, removida ou alterada.

Escala de confiança: **Alta** (evidência direta no dado) · **Média** (forte
indício, falta uma verificação) · **Baixa** (só aparência, precisa de contexto
do negócio).

---

## 1. `Base Produção` e `BASE_MÁQ_EMB` (Base Aparas 2024/2025/2026)

- **O que faz:** guarda o evento de máquina (parada, setup, produção).
- **Dados:** 389.435 + 168.329 linhas (2024); 367.520 + 168.835 (2025). 22 colunas.
- **Sobreposição:** total com `BASE_DETALHE` (mesmo arquivo, mesmas 22 colunas) e
  com `Base Máquina_Embalagem` do Indicadores Diário.
- **Importância:** alta em volume, desconhecida em uso — ninguém consome.
- **Problemas:** três abas com o mesmo layout no mesmo arquivo, sem indicação
  de qual é a oficial. Multiplicam o tamanho do arquivo (68–75 MB cada).
- **Recomendação:** manter **uma** por arquivo e descontinuar as outras duas —
  mas só depois de comparar período e contagem de cada uma.
- **Confiança:** **Média.** O layout é idêntico, mas não verifiquei se cobrem
  os mesmos meses. Pode ser que uma seja o ano fechado e outra o parcial.

---

## 2. `Histórico Refugo` (Refugo Aparas.xlsx)

- **O que faz:** série mensal de volume e scrap por planta.
- **Dados:** 37 linhas, 7 colunas.
- **Sobreposição:** é subconjunto de `Conta Refugo` (66 linhas, 15 colunas),
  que já usamos. Só adiciona a coluna `YTD`, que é derivável.
- **Importância:** baixa.
- **Problemas:** menos linhas e menos colunas que a alternativa; nome sugere
  histórico mas cobre período menor.
- **Recomendação:** descontinuar, mantendo `Conta Refugo` como fonte.
- **Confiança:** **Alta.** Mesmas colunas base, mesma origem, menos dado.

---

## 3. `Refugo_Separado`, `Master Plan`, `Porcent. Aparas` (Refugo Aparas.xlsx)

- **O que faz:** recortes da mesma série mensal de refugo.
- **Dados:** 97 / 63 / 46 linhas.
- **Sobreposição:** alta com `Conta Refugo`.
- **Importância:** `Master Plan` tem `REFILE JGR` e `RODA CARROÇA`, que
  `Conta Refugo` **não tem** — então não é puramente redundante.
- **Problemas:** três formatos do mesmo número convivendo.
- **Recomendação:** **não descontinuar `Master Plan`** (tem informação
  exclusiva); avaliar `Refugo_Separado` (formato longo do mesmo dado) e
  `Porcent. Aparas` (pivot) como descartáveis.
- **Confiança:** Alta para Refugo_Separado/Porcent. Aparas · **Baixa** para
  Master Plan — pode ser a fonte "oficial" do time.

---

## 4. Cópias literais e backups

| Base | Evidência | Confiança |
|---|---|---|
| `Planilha5 (2)` (Base Aparas 2025) | 4.869 linhas idênticas a `Planilha5` | **Alta** |
| `D_PRODUTIVIDADE (2)` e `(3)` (Machine Card Genérico) | mesmo layout de 71 linhas ×3 | **Alta** |
| `D_MasterPlan (2)` (Machine Card 2025) | idem, 56 linhas | **Alta** |
| `Backup` (Refugo Produção) | 145 linhas vs 367 do `Formulário` | **Alta** |
| `Backup` (Aderência Semanal) | 283 vs 208 do `Base OP Faturamento` | **Média** — o backup tem MAIS linhas que o original |
| `Semanas` vs `Tabela Semana` | 427 linhas cada, DATA→SEMANA | **Alta** — manter uma |

- **Recomendação:** são rascunhos/backups manuais, sem consumidor. Descontinuar
  as cópias mantendo a principal.
- **Ressalva:** o `Backup` da Aderência tem **mais** linhas que o "original" —
  pode ser que o original é que esteja incompleto.

---

## 5. `Produção Antiga` (Aderência Semanal.xlsx)

- **O que faz:** evento de máquina em formato antigo.
- **Dados:** 113.394 linhas, 19 colunas (o formato atual tem 22–25).
- **Sobreposição:** com todas as bases de apontamento atuais.
- **Importância:** possivelmente histórica — pode cobrir período que as bases
  atuais não cobrem.
- **Problemas:** o próprio nome diz "Antiga"; faltam colunas do formato atual.
- **Recomendação:** verificar o período coberto. Se estiver dentro do que as
  bases atuais já cobrem → descontinuar. Se for anterior → **manter como
  histórico**, não descartar.
- **Confiança:** **Baixa** para descarte — não verifiquei o período.

---

## 6. `Classificação` (Indicadores Diário) — versão não-oficial

- **O que faz:** tabela de domínio código → descrição → classificação.
- **Dados:** 112 linhas, igual à `ClassificaçãoOficial`.
- **Sobreposição:** total, **exceto o formato do código**: `1` vs `01`.
- **Importância:** o `CodApont` nas bases de evento vem zero-padded (`"01"`),
  então quem casa é a **Oficial**.
- **Recomendação:** adotar `ClassificaçãoOficial` como fonte e descontinuar a outra.
- **Confiança:** **Alta.** A diferença de padding é verificável no dado.

---

## 7. `Detalhes1` (Sequenciamento mensal)

- **O que faz:** fardo a fardo, mesmas colunas de `COMPLETOS`.
- **Dados:** 492 linhas vs 467 de `COMPLETOS` (setembro).
- **Sobreposição:** quase total. `Detalhes1` traz a **descrição** da
  classificação; `COMPLETOS` traz só o código.
- **Problemas:** as ~25 linhas de diferença não estão explicadas.
- **Recomendação:** **não descontinuar ainda.** Primeiro entender a diferença
  de contagem — se `Detalhes1` tiver fardos que faltam em `COMPLETOS`, ela é
  que é a mais completa, e a decisão inverte.
- **Confiança:** **Baixa.** É exatamente o caso em que descartar cedo perderia dado.

---

## 8. `Sequenciamento Acumulado 2026.xlsx` 🔴 CONFIRMADO: duplica dado no painel hoje

- **O que faz:** entra em `fardos_aparas` junto com os 9 arquivos mensais.
- **Verificação feita** (consultas no Supabase, 2026-09-09):

| Fonte | Período | Linhas | Dias distintos | kg bruto |
|---|---|---:|---:|---:|
| Acumulado | 2026-01-02 → **2026-06-12** | 1.724 | 140 | 401.493 |
| Mensais | 2026-01-02 → **2026-08-29** | 3.786 | 203 | 565.163 |

Restringindo os dois ao **mesmo período** (01/01 a 12/06/2026):

| | Acumulado | Mensais |
|---|---:|---:|
| Linhas | 1.724 | 1.725 |
| kg bruto | 401.493 | 401.537 |

Pares `(data, nº do fardo)` presentes **nas duas** fontes: **1.495**.

- **Conclusão:** é o **mesmo dado**, duplicado. Diferença de 1 linha e 44 kg
  entre as duas fontes no mesmo intervalo. O período do acumulado está
  inteiramente contido no dos mensais, que ainda vão dois meses além.
- **Efeito visível no painel** (`v_fardos_mensal`):

| Mês | kg bruto | apara % |
|---|---:|---:|
| jan/26 | 142.413 | 24,68% |
| fev/26 | 138.143 | 26,30% |
| mar/26 | 163.784 | 23,05% |
| abr/26 | 161.378 | 25,59% |
| mai/26 | 146.442 | 14,58% |
| **jun/26** (overlap acaba dia 12) | 85.134 | 10,05% |
| jul/26 (sem overlap) | 65.395 | 8,66% |
| ago/26 (sem overlap) | 63.966 | 6,58% |

O degrau é exatamente onde a sobreposição termina: jan–abr com volume ~2x e
apara ~25%, contra ~6-8% nos meses limpos. **O KPI "Apara Confirmada" está
errado de janeiro a junho de 2026.**

- **Recomendação:** remover o acumulado da carga de `fardos_aparas` (os mensais
  cobrem o mesmo período e vão além), mantendo o arquivo catalogado como base
  de inventário para não perder o dado.
- **Confiança:** **Alta.** Verificado no dado, com efeito mensurável no painel.
- **Status:** aguardando seu aval — é uma decisão de "qual base deixa de ser
  usada", e combinamos que isso não seria decidido nesta fase.

---

## 9. Abas de pivot e painel (não são "base")

`DIM`, `Dinamica`, `Planilha1..7`, `CONTABILIZAÇÃO`, `Modelo Diário`,
`Acumulado Mês`, `Din`, `DIN SEMANAL`, `Gráfico`, `Sylvamo`, `Analise`,
`Dados`, `Representatividade`, `Consolidação`, `TABELA`, `KPI_MasterPlan`.

- **O que fazem:** apresentação e conferência dentro do Excel.
- **Recomendação:** não são candidatas a virar tabela — são **saída**, não fonte.
  Mas **não devem ser apagadas** dos arquivos originais: é como o time trabalha.
- **Confiança:** **Alta** de que não viram base · **Alta** de que devem
  permanecer nos arquivos.

---

## O que fazer antes de decidir qualquer coisa

Em ordem de urgência:

1. ~~**Sequenciamento Acumulado**~~ — ✅ **verificado**: confirmado que duplica
   jan–jun/2026 e distorce o KPI de apara confirmada. Falta só o aval para corrigir.
2. **`aderencia_programacao` órfã** — o indicador "Aderência ao Plano" do painel
   sai de uma tabela que nenhum arquivo alimenta. Ver `MAPA_ORIGEM_DADOS.md`.
3. **`tendencia_mensal` vazia** — carga quebrada em silêncio desde sempre.
4. **Períodos de `Base Produção` × `BASE_MÁQ_EMB` × `BASE_DETALHE`** — decide a
   maior redundância do acervo.
5. **Contagem de chave da ADERÊNCIA DIÁRIA** — destrava a Fase 3.

Nenhum desses cinco exige decisão de negócio: são verificações no dado.
Posso rodar todas se você quiser.
