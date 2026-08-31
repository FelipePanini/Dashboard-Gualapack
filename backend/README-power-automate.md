# Carga diária de dados reais — Power Automate (sem TI, sem admin)

Nenhum passo aqui precisa de acesso administrador nem de TI. Tudo roda com o
seu próprio login do Microsoft 365, usando o **Power Automate** (já incluído
na maioria dos planos do 365 — a licença gratuita "per-user plan" também
serve pra isso).

```
Planilhas (sua pasta no OneDrive/SharePoint)
        │
        ▼
Power Automate — flow agendado, roda com sua conta, sem app nem admin consent
        │  (lê as linhas da planilha, chama uma URL)
        ▼
Supabase — função "ingest" grava no banco central
        │
        ▼
Dashboard (GitHub Pages) — lê do Supabase, como já faz hoje
```

## 1. Rodar os schemas no Supabase (uma vez só)

`SQL Editor` do Supabase → colar e rodar, nesta ordem:
1. `backend/schema.sql` (se ainda não rodou)
2. `backend/schema_data.sql`

## 2. Publicar a função `ingest` no Supabase

Igual ao que você já fez pra função `register`:
- Painel do Supabase → `Edge Functions` → `Deploy a new function`.
- Nome: **`ingest`** (exatamente esse).
- Cole o conteúdo de [`functions/ingest/index.ts`](./functions/ingest/index.ts).
- Em `Settings` da função → `Secrets`, adicione:
  - `INGEST_SHARED_SECRET`: invente uma senha longa e aleatória (ex: gere em
    [1password.com/password-generator](https://1password.com/password-generator/),
    32+ caracteres). Guarde essa mesma senha — vai usar no Power Automate.
  - (`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente
    em toda Edge Function do projeto, não precisa recriar.)
- Também em `Settings`, **desligue "Enforce JWT Verification"** — quem chama
  essa função é o Power Automate, sem sessão de usuário; a proteção real é o
  `INGEST_SHARED_SECRET` checado dentro do código.
- Anote a URL final:
  `https://SEU_PROJECT_REF.supabase.co/functions/v1/ingest`

## 3. Preparar cada planilha de origem

Cada planilha (export do BI ou controle manual) precisa estar em formato
**Excel (.xlsx) com os dados numa Tabela** (não só um intervalo de células —
selecione os dados e `Inserir > Tabela` no Excel, se ainda não for uma).
Isso é o que permite o Power Automate ler "linha por linha" sem código.

As colunas de cada tabela Excel devem ter o mesmo nome das colunas da tabela
correspondente no banco (`backend/schema_data.sql`):

| Planilha (Tabela do Excel) | Tabela no banco |
|---|---|
| Máquinas (diário) | `maquinas_diario` |
| Perdas (diário) | `perdas_diario` |
| Ordens de produção | `ops_diario` |
| WIP | `wip_diario` |
| Carteira | `carteira_diario` |
| Apontamentos | `apontamentos` |

Se os nomes das colunas nas planilhas reais forem diferentes dos que estão em
`schema_data.sql`, me diga os nomes reais que eu ajusto o schema pra bater
exatamente — mais fácil mudar o banco do que pedir pra reformatar planilha.

## 4. Criar o flow no Power Automate

Em [make.powerautomate.com](https://make.powerautomate.com) (entra com o
mesmo login do 365):

1. `Criar` → `Fluxo de nuvem agendado`.
   - Nome: `Sync diário - Painel Produção`.
   - Repetir a cada `1` `Dia`, no horário que preferir (ex: 6h da manhã).
2. Adicionar uma ação **"Listar linhas presentes em uma tabela"** (conector
   Excel Online (Business)):
   - Localização: OneDrive ou SharePoint Site, onde está a planilha.
   - Arquivo: selecione a planilha (ex: "Máquinas diário.xlsx").
   - Tabela: selecione a tabela dentro dela.
3. Adicionar uma ação **HTTP**:
   - Método: `POST`
   - URI: a URL da função `ingest` (passo 2).
   - Cabeçalhos:
     ```
     Content-Type: application/json
     x-ingest-secret: <a senha que você gerou no passo 2>
     ```
   - Corpo:
     ```json
     {
       "table": "maquinas_diario",
       "rows": @{outputs('Listar_linhas_presentes_em_uma_tabela')?['body/value']}
     }
     ```
     (o nome exato entre `@{outputs(...)}` é o nome da ação anterior — o
     Power Automate autocompleta isso se você clicar em "Conteúdo dinâmico"
     e escolher o valor da ação de listar linhas, em vez de digitar à mão.)
4. Repita os passos 2–3 para cada planilha/tabela da lista acima (o mesmo
   flow pode ter 6 blocos "Listar linhas" + "HTTP", um par por tabela).
5. Salvar e clicar em **"Testar"** → "Manualmente" pra rodar agora e conferir.

## 5. Conferir que funcionou

No Supabase, `SQL Editor`:
```sql
select * from sync_log order by started_at desc limit 10;
select * from maquinas_diario order by data_ref desc limit 10;
```

Se aparecer `status = 'error'` no `sync_log`, o campo `detalhe` mostra o
motivo (geralmente nome de coluna que não bate com o schema).

## 6. Segurança

- O `INGEST_SHARED_SECRET` é a única coisa protegendo a gravação — trate como
  senha (não cole em chat, print, etc.). Se vazar, gere um novo no Supabase e
  atualize no Power Automate.
- Como o flow roda com a sua conta, ele só enxerga arquivos que você já tem
  acesso — não precisa dar nenhuma permissão nova a ninguém.
- Se você sair da empresa ou perder acesso, o flow para de funcionar (porque
  depende do seu login) — nesse caso, qualquer outra pessoa pode "assumir a
  propriedade" do flow no Power Automate, ou recriar com a conta dela.

## Próximo passo no front-end

Depois que a primeira carga rodar com sucesso, troco os arrays fixos
(`MAQUINAS`, `TIPOS_PERDA`, `APARAS_MENSAL` etc.) em `demo/index.html` por
`supabase.from(...).select(...)` — os gráficos e o layout continuam iguais,
só a origem do número muda.
