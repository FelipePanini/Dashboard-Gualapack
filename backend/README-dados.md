# Dados reais — upload direto pelo painel

Sem SharePoint automático, sem Power Automate, sem app registrado no Azure.
Quem atualiza os dados faz isso **de dentro do próprio painel**, arrastando
a planilha (ou a aba certa dela) — o mesmo login de admin que já existe.

```
Planilha real (algumas são grandes/têm várias abas — corte com tools/planilha-uma-aba.js)
        │
        ▼
demo/upload.html — admin arrasta o arquivo (ou a aba já cortada), escolhe a aba se precisar
        │
        ▼
Função "ingest" no Supabase — lê a planilha e grava no banco central
        │
        ▼
Dashboard já mostra o dado novo
```

## 1. Rodar os schemas no Supabase

`SQL Editor` do Supabase → colar e rodar, nesta ordem (**rode `schema_data.sql`
de novo mesmo se já rodou antes** — as tabelas mudaram pra bater com as
planilhas reais):
1. `backend/schema.sql` (se ainda não rodou)
2. `backend/schema_data.sql`

## 2. Publicar a função `ingest` (atualizada)

- Painel do Supabase → `Edge Functions` → abre `ingest` → cola o conteúdo
  novo de [`functions/ingest/index.ts`](./functions/ingest/index.ts) por
  cima → `Deploy`.
- Mantenha **"Enforce JWT Verification" ligado**.

## 3. Planilhas grandes/com várias abas — corte primeiro

Algumas planilhas reais pesam 15–100 MB e têm várias abas — grande demais
pra arrastar direto. Pra essas, use o script local (roda no seu computador,
não manda nada pra fora):

```bash
cd tools
npm install          # só na primeira vez
node planilha-uma-aba.js "Indicadores Diário - 2026.xlsx" --listar
node planilha-uma-aba.js "Indicadores Diário - 2026.xlsx" "Base Máquina_Embalagem" "apontamentos-hoje.xlsx"
```

Isso gera um arquivo novo, bem menor, com **só** a aba escolhida — os dados
dentro dela não são alterados nem resumidos, só as outras abas são
descartadas. Depois é só arrastar o arquivo gerado (`apontamentos-hoje.xlsx`
no exemplo) em `demo/upload.html`.

Planilhas pequenas (sequenciamento mensal de fardos, tendência, etc.) podem
ir direto, sem passar pelo script.

## 4. Mapeamento planilha → card → tabela

| Card no upload | Tabela | Planilha de origem | Aba a usar |
|---|---|---|---|
| Apontamentos | `apontamentos` | `Indicadores Diário - 2026.xlsx` (ou `Base Aparas - 2026.xlsx`) | `Base Máquina_Embalagem` (ou `BASE_DETALHE`) — **corte com o script antes**, é enorme |
| Fardos de aparas | `fardos_aparas` | `0X. SEQUENCIAMENTO DOS FARDOS DE APARAS JGR - <mês> 2026.xlsx` ou `Sequenciamento Acumulado 2026.xlsx` | `COMPLETOS` (planilhas mensais) ou a aba única do acumulado |
| Aderência — máquinas (diário) | `aderencia_maquinas_diaria` | `Aderência Máquinas - Diária.xlsx` | `Apontamentos_produção` — **corte com o script antes** |
| Aderência — programação | `aderencia_programacao` | `Histórico Aderência Programação.xlsx` | `Programação Passado` — **corte com o script antes**, é enorme |
| Refugo/aparas — histórico | `refugo_aparas_historico` | `Refugo Aparas.xlsx` | `Histórico Refugo` |
| Tendência mensal | `tendencia_mensal` | `Graficos Tendência.xlsx` | `Dados Prod` |
| Catálogo de máquinas | `maquinas` | `Machine Card Oficial - Genérico.xlsx` | `DIM_EQTOS & GRUPO EQTO` |

`Refugo Produção.xlsx` (estrutura de produto/engenharia) e `Base Aparas -
Genérico/2024/2025.xlsx` (histórico anual, mesmo formato de `apontamentos`)
ficam de fora por enquanto — não mapeiam pra nenhum gráfico do painel ainda.
Se quiser incluir histórico de anos anteriores, é só cortar a aba e subir
como `apontamentos` também (mesma estrutura).

## 5. Colunas esperadas por tabela

A primeira linha do arquivo (ou da aba) precisa ter esses nomes de coluna —
acentos e maiúsculas não importam, a função normaliza sozinha.

- **`apontamentos`**: `NumOrdem`, `CodRecurso`, `CodApont`, `Cod_Desc`, `DtProducao`, `HoraInicio`, `HoraFim`, `QtdHoras`, `QtdProduzida`, `Turno`, `DesperdicioAcerto`, `DesperdicioVirando`, `usr_PesoBrutoBobina`, `usr_tipodaperda`, `usr_kgdaperda`, `TipoProduto`, `CodEstrutura`, `Des_NumOrdem`, `CodEst`, `Processo`, `Classificacao` (+ `NomeOperador`, `NomeCliente` se vierem de `Base Aparas`)
- **`fardos_aparas`**: `CÓDIGO`, `DP ou FP`, `REFUGO`, `REFILE`, `DATA`, `Nº`, `QTD BRUTA (KG)`, `QTD LÍQUIDA (KG)`, `NOME`, `CLASSIFICAÇÃO`, `TIPO`
- **`aderencia_maquinas_diaria`**: `NumOrdem`, `DtProducao`, `QtdProduzida`, `CodRecurso`, `QtdHoras`, `Classificacao`, `Descrição`, `CodEstrutura`, `Turno`, `Cod_Desc`, `CodApont`
- **`aderencia_programacao`**: `CodCliente`, `CodEstrutura`, `Recurso_Ctr`, `TipoProduto`, `NumOrdem`, `DtSaidaMaquina`, `Descricao`, `Cliente`, `Atividade`, `Qtd_Produzido`, `QtdPLanejado`, `Meta_qtd_acerto`, `Qtd_AcertoReal`, `Min_Set_Prog`, `Mini_Set_Real` (vira `min_set_real`), `Qtd_ProdKg`, `Meta_Mts_Hora`, `Qtd_HorP`, `Cilindro`
- **`refugo_aparas_historico`**: `DATE`, `VOLUME JGR`, `SCRAP JGR`, `VOLUME ORF`, `SCRAP ORF`
- **`tendencia_mensal`**: precisa ser reorganizada antes — a aba original é uma tabela "larga" (vários blocos lado a lado). Monte uma versão simples com colunas `mes`, `ano`, `volume_prod_corte_km`, `lote_medio_km`, `volume_prod_kg`, `aparas_kg`, `aparas_pct` — uma linha por mês.
- **`maquinas`**: `id` (código da máquina, ex: `REB 01`), `grupo` (ex: `CORTADEIRAS`), `considerar` (`S`/`N`) — pode precisar renomear o cabeçalho da planilha original antes de subir.

Se algum nome real não bater exatamente com o que está aqui, me manda o
cabeçalho real (a primeira linha da aba) que eu ajusto o schema — é mais
fácil mudar o banco do que reformatar a planilha que o time já usa.

## 6. Conferir que funcionou

```sql
select * from sync_log order by started_at desc limit 10;
select * from apontamentos order by dt_producao desc limit 10;
```

## 7. Ativar a sincronização automática (quando a TI liberar o acesso)

O upload manual continua sendo o fluxo real até lá. Mas o script que vai
substituir isso já está pronto e esperando, em
[`backend/sync-sharepoint/`](./sync-sharepoint/) — mesma lógica de detecção
de tabela/aba do `upload.html`, só que rodando sozinho todo dia via GitHub
Actions em vez de alguém arrastar arquivo.

Quando a TI devolver os três valores do registro do app (Tenant ID, Client
ID, Client Secret — ver o pedido que te passei), o que falta é só
configuração, nenhum código novo:

1. No repositório: `Settings` → `Secrets and variables` → `Actions` →
   criar 6 secrets:

   | Secret | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://iwocigbdywkypvagrrjk.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `Project Settings > API > service_role` no Supabase |
   | `MS_TENANT_ID` | devolvido pela TI |
   | `MS_CLIENT_ID` | devolvido pela TI |
   | `MS_CLIENT_SECRET` | devolvido pela TI |
   | `SHAREPOINT_SITE` | ex: `gualapackspa-my.sharepoint.com:/personal/felipe_panini_gualapack_com` |
   | `SHAREPOINT_FOLDER_PATH` | caminho da pasta dentro do site acima |

2. Testar manualmente: aba `Actions` do repositório → `Carga automática via
   SharePoint (pré-montado — inativo)` → `Run workflow`. Confira o resultado
   em `sync_log` no Supabase.
3. Depois de validar, edite
   [`.github/workflows/sync-sharepoint.yml`](../.github/workflows/sync-sharepoint.yml)
   e descomente o bloco `schedule:` — passa a rodar sozinho todo dia às 3h
   (horário de Brasília).

A partir daí `upload.html` vira só um botão de emergência (subir manual se
o automático falhar por algum motivo), não mais a rotina do dia a dia.

## Próximo passo: os gráficos do painel

As tabelas e o upload já refletem a estrutura real. O próximo passo é trocar
os arrays fictícios em `demo/index.html` pelos `select` dessas tabelas e
ajustar os gráficos pra essas colunas (ex: TMR/velocidade agora vêm de
`apontamentos` agregado por máquina/dia, não de uma tabela pronta) —
mantendo o mesmo estilo visual atual. Isso é a próxima etapa, ainda não
feita nesta rodada.
