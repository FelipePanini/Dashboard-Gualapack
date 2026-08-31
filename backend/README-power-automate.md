# Carga diária de dados reais — 1 flow só, sem mexer planilha por planilha

Nenhum passo aqui precisa de acesso administrador, TI, ou transformar as
planilhas em Tabela do Excel. **Um único flow no Power Automate** observa a
pasta inteira do SharePoint — qualquer arquivo que mudar lá, ele manda pra
função `ingest`, que entende sozinha qual planilha é aquela e onde gravar.

```
Planilhas (sua pasta no SharePoint — do jeito que já é hoje)
        │
        ▼
Power Automate — 1 flow, gatilho "arquivo criado ou alterado na pasta"
        │  (manda o arquivo bruto)
        ▼
Supabase — função "ingest" identifica a planilha, lê e grava sozinha
        │
        ▼
Dashboard (GitHub Pages)
```

## 1. Rodar os schemas no Supabase (uma vez só)

`SQL Editor` do Supabase → colar e rodar, nesta ordem:
1. `backend/schema.sql` (se ainda não rodou)
2. `backend/schema_data.sql`

## 2. Publicar a função `ingest`

- Painel do Supabase → `Edge Functions` → `Deploy a new function`.
- Nome: **`ingest`** (exatamente esse).
- Cole o conteúdo de [`functions/ingest/index.ts`](./functions/ingest/index.ts).
- Em `Settings` da função → `Secrets`, adicione:
  - `INGEST_SHARED_SECRET`: uma senha longa e aleatória (gere em
    [1password.com/password-generator](https://1password.com/password-generator/)).
    Guarde essa senha — vai usar no Power Automate.
- Em `Settings`, **desligue "Enforce JWT Verification"**.
- Anote a URL: `https://SEU_PROJECT_REF.supabase.co/functions/v1/ingest`

## 3. Nomear as planilhas (o único cuidado que resta)

A função reconhece a planilha certa pelo **nome do arquivo** — não precisa
ser exato, só precisa *conter* uma dessas palavras (maiúscula/minúscula e
acento não importam):

| O nome do arquivo precisa conter... | Vira a tabela |
|---|---|
| `maquinas_diario` (ex: "Máquinas Diário.xlsx") | `maquinas_diario` |
| `perdas_diario` | `perdas_diario` |
| `ops_diario` | `ops_diario` |
| `wip_diario` | `wip_diario` |
| `carteira_diario` | `carteira_diario` |
| `apontamentos` | `apontamentos` |

Se os arquivos reais já tiverem nomes bem diferentes disso (ex: "Refugo
Semanal.xlsx"), me diga os nomes reais que eu ajusto a lista — mais fácil
mudar o código do que renomear planilha que o time já usa.

**Não precisa** virar Tabela do Excel (`Ctrl+T`) — a função lê a primeira
aba da planilha inteira, contanto que a primeira linha seja o cabeçalho
(nome das colunas) e os dados comecem na linha 2. É como a maioria das
planilhas já vem.

## 4. Criar o flow (uma vez só, cobre TODAS as planilhas)

Em [make.powerautomate.com](https://make.powerautomate.com):

1. `Criar` → `Fluxo de nuvem automatizado`.
   - Nome: `Sync diário - Painel Produção`.
   - Gatilho: **"Quando um arquivo é criado ou modificado (somente
     propriedades)"** (conector SharePoint) — ou o equivalente do OneDrive,
     dependendo de onde está a pasta.
   - Configure apontando pra pasta onde estão as planilhas (a pasta inteira,
     não um arquivo específico).
2. Adicionar ação **"Obter conteúdo do arquivo"** (SharePoint/OneDrive),
   usando o ID do arquivo que veio do gatilho.
3. Adicionar ação **HTTP**:
   - Método: `POST`
   - URI: a URL da função `ingest` (passo 2).
   - Cabeçalhos:
     ```
     Content-Type: application/json
     x-ingest-secret: <a senha do passo 2>
     ```
   - Corpo (use "Conteúdo dinâmico" pra inserir o nome do arquivo e o
     conteúdo em base64 — o Power Automate já entrega o arquivo em base64
     automaticamente na ação anterior):
     ```json
     {
       "fileName": "@{triggerOutputs()?['body/{FilenameWithExtension}']}",
       "contentBase64": "@{base64(body('Obter_conteúdo_do_arquivo'))}"
     }
     ```
4. Salvar. Pronto — esse único flow cobre qualquer planilha que existir hoje
   ou for adicionada depois na pasta, sem precisar criar um flow novo pra
   cada uma.

## 5. Testar

- Edite/salve uma das planilhas na pasta do SharePoint (ou use "Testar" →
  "Manualmente" no próprio flow).
- No Supabase: `select * from sync_log order by started_at desc limit 10;`
  — o campo `detalhe` mostra qual arquivo caiu em qual tabela, ou o motivo
  do erro se algo não bateu.

## 6. Segurança

- O `INGEST_SHARED_SECRET` é a única coisa protegendo a gravação — trate
  como senha.
- O flow roda com a sua conta — só enxerga arquivos que você já acessa.

## Próximo passo no front-end

Depois que a primeira carga rodar com sucesso, troco os arrays fixos
(`MAQUINAS`, `TIPOS_PERDA`, `APARAS_MENSAL` etc.) em `demo/index.html` por
`supabase.from(...).select(...)` — os gráficos e o layout continuam iguais,
só a origem do número muda.
