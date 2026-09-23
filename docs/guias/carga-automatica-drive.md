# Carga automática via Google Drive — passo a passo

Sem depender de TI, sem app no Azure, sem admin da Gualapack. Uma conta de
serviço do Google (você mesmo cria) lê a pasta do Drive onde ficam as
planilhas e, todo dia, leva o dado até o Supabase em duas etapas:

```
Planilhas originais (Excel) — atualizadas pelo time e copiadas pra pasta do Drive
        │
        ▼  ETAPA 1 — 02:00 (Brasília) — build-database-central.yml
DATABASE_GUALAPACK.xlsx — arquivo central, na mesma pasta do Drive
        │
        ▼  ETAPA 2 — logo em seguida, só se a 1 deu certo — sync-drive.yml
Supabase — tabelas + funções que o painel lê
        │
        ▼
Painel atualizado (o selo no topo mostra até que dia vai o dado)
```

Os passos 1 a 9 são configuração, feita uma vez só (e já feita no projeto de
produção). Os passos 10 em diante são o uso do dia a dia.

---

## Passo 1 — Criar um projeto no Google Cloud

1. Abra [console.cloud.google.com](https://console.cloud.google.com) com a
   **mesma conta Google** dona da pasta do Drive.
2. Seletor de projeto (ao lado do logo "Google Cloud") → **New Project**.
3. Nome: `gualapack-painel-sync` (pode ser outro). **Create**.
4. Confirme que o seletor no topo mostra o projeto novo.

## Passo 2 — Ativar a API do Google Drive

1. [console.cloud.google.com/apis/library](https://console.cloud.google.com/apis/library)
   com o projeto certo selecionado.
2. Busque `Google Drive API` → **Enable**.

## Passo 3 — Criar a conta de serviço

1. [IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   → **+ Create Service Account**.
2. Nome: `painel-sync`. **Anote o e-mail** gerado (termina em
   `.iam.gserviceaccount.com`) — vai precisar no Passo 5.
3. **Create and Continue** → não selecione nenhuma role → **Continue** →
   **Done**.

## Passo 4 — Gerar a chave (JSON) da conta de serviço

1. Clique na conta criada → aba **Keys** → **Add Key** → **Create new key**
   → **JSON** → **Create**.
2. O arquivo `.json` baixado é a credencial. **Guarde com cuidado** e nunca
   coloque no repositório — ele só vai virar um GitHub Secret (Passo 8).

## Passo 5 — Compartilhar a pasta do Drive com a conta de serviço

1. Abra a pasta do Drive → **Share**.
2. Cole o e-mail da conta de serviço (Passo 3).
3. Permissão: **Editor**. A etapa 1 precisa *gravar* o arquivo central na
   pasta; com "Leitor" ela falha com erro 403.
4. Desmarque "notificar por e-mail" → **Share**.

## Passo 6 — Criar o arquivo central vazio (uma vez só)

A conta de serviço não tem cota própria de armazenamento no Drive — ela
consegue **atualizar** um arquivo que já existe, mas não **criar** um novo.
Por isso uma pessoa cria o arquivo uma vez:

1. Na pasta, crie uma planilha vazia chamada exatamente
   `DATABASE_GUALAPACK.xlsx`.
2. Pronto — a partir daí a etapa 1 só substitui o conteúdo dela.

## Passo 7 — Anotar o ID da pasta

No link da pasta, é o trecho depois de `/folders/`:

```
DRIVE_FOLDER_ID = 191x0GBpe6EX5srUFOzbzoUDAvi7JaUSZ
```

## Passo 8 — Cadastrar os secrets no GitHub

Repositório → `Settings` → `Secrets and variables` → `Actions` →
`New repository secret`. Quatro secrets:

| Nome do secret | Valor |
|---|---|
| `SUPABASE_URL` | Supabase → `Project Settings` → `API` → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → `Project Settings` → `API` → `service_role` (chave secreta) |
| `DRIVE_FOLDER_ID` | o ID do Passo 7 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | conteúdo **inteiro** do `.json` do Passo 4 (abrir no Bloco de Notas, `Ctrl+A`, `Ctrl+C`, colar) |

Nenhum desses valores aparece no código — os workflows leem só daqui.

## Passo 9 — Criar as tabelas no Supabase

`SQL Editor` do Supabase → rode, nesta ordem (ver
[configurar-supabase.md](./configurar-supabase.md)):

1. `backend/sql/schema.sql`
2. `backend/sql/schema_data.sql`
3. `backend/sql/schema_views.sql`

---

## Passo 10 — Como as planilhas são reconhecidas

A carga identifica cada planilha **pelo nome do arquivo** e a aba **pelo nome
da aba** (maiúscula/minúscula e acento não importam). A regra completa está em
`TABLE_DEFS`, em [`backend/sync-drive/lib.js`](../../backend/sync-drive/lib.js):

| Nome do arquivo contém | Aba lida | Vira a tabela |
|---|---|---|
| `indicadores` | Base Apontamento | `apontamentos` |
| `indicadores` | Base Apontamentos (kg) | `producao_kg` |
| `indicadores` | Classificação Oficial | `classificacao_apontamento` |
| `base aparas` | BASE_DETALHE | `apontamentos` (sem duplicar eventos da Base Apontamento) |
| `sequenciamento` (mas não `acumulado`) | COMPLETOS | `fardos_aparas` |
| `acumulado` | Percentual Scrap BI | `scrap_bi_mensal` |
| `aderencia` | ADERÊNCIA DIÁRIA | `aderencia_programacao` |
| `refugo aparas` | Conta Refugo | `refugo_aparas_historico` |
| `refugo produção` | Consulta Perda | `refugo_producao` |
| `machine card` | Produção (Metros) | `producao_metros` |
| `machine card` | DIM_EQTOS & GRUPO EQTO | `maquinas` |
| `tendencia` ou `grafico` | Dados Prod | `tendencia_mensal` (hoje sai vazia) |

Os nomes reais ("Indicadores Diário - 2026.xlsx", "09. SEQUENCIAMENTO DOS
FARDOS DE APARAS JGR - Setembro 2026.xlsx"...) já batem com essas palavras.
**Renomear um arquivo ou uma aba pode tirá-lo da carga** — se precisar,
avise antes pra ajustar o `TABLE_DEFS`.

Eventos de máquina (apontamentos, refugo, produção) guardam só os **últimos
12 meses** — o plano gratuito do Supabase tem 500 MB.

## Passo 11 — Rotina do dia a dia

1. Atualize as planilhas no Excel (Dados → Atualizar Tudo) e deixe a versão
   nova na pasta do Drive.
2. Às **02:00** a etapa 1 monta o arquivo central; a etapa 2 carrega o
   Supabase em seguida. Não precisa fazer nada.
3. Precisa do dado antes? Aba **Actions** → **Montar base central
   (DATABASE_GUALAPACK.xlsx)** → **Run workflow**. A etapa 2 começa sozinha
   quando ela terminar (~10 min no total).

## Passo 12 — Conferir se deu certo

- **No painel**: o selo no topo mostra até que dia vai o dado. Fica âmbar
  quando o dado tem mais de 2 dias.
- **No arquivo central**: a aba `DB_CONTROLE` do `DATABASE_GUALAPACK.xlsx`
  mostra, pra cada aba, quantas linhas entraram, de quais arquivos, o período
  coberto e o que falhou (colunas `status`, `observacoes`, `arquivos_com_falha`).
- **No Supabase**:
  ```sql
  select * from sync_log order by started_at desc limit 5;
  select * from v_dados_status;
  ```

---

## Erros comuns

| Mensagem no log | Causa provável | O que fazer |
|---|---|---|
| `Faltando variável de ambiente: ...` | Secret não criado ou com nome diferente | Confira os 4 nomes do Passo 8 |
| `Não consegui listar a pasta` / 403 / 404 | Pasta não compartilhada com o e-mail certo | Repita o Passo 5 |
| 403 ao gravar o arquivo central | Conta de serviço como "Leitor" | Troque pra **Editor** (Passo 5) |
| `"DATABASE_GUALAPACK.xlsx" não encontrado` | Arquivo central não existe | Passo 6 |
| `aba "..." pulada: N linhas, acima do teto` | A aba passou do limite de linhas que o build consegue ler (`TETO_LINHAS_TABELA` em `build-database-central.js`) | A etapa 2 **mantém o dado anterior** desse arquivo (`[mantido]` no log). Suba o teto ou divida a aba |
| `[mantido] ... falhou no build` | O arquivo não pôde ser lido hoje | Nada se perde; conserte o arquivo e rode de novo |
| `nenhuma coluna bateu com o esperado` | Cabeçalho da aba mudou | Compare o cabeçalho com `allowed` no `TABLE_DEFS` |
