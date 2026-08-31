# Carga diária de dados reais — GitHub Actions

Sem servidor próprio: a carga diária roda de graça no **GitHub Actions**, o
mesmo lugar que já hospeda o site. Lê os CSVs (BIs exportados + planilhas
manuais) de uma pasta única no Google Drive e grava no Supabase Postgres.

```
Planilhas/BIs (pasta na nuvem)
        │
        ▼
GitHub Actions — roda "sync.js" todo dia (cron nativo, .github/workflows/sync-daily.yml)
        │
        ▼
Supabase Postgres — banco central único (dados + auth + RLS)
        │
        ▼
Dashboard (GitHub Pages)
```

## 1. Rodar o schema de dados (uma vez só)

`SQL Editor` do Supabase → colar e rodar `backend/schema_data.sql` (depois de
`schema.sql`, já rodado antes).

## 2. Criar a pasta única na nuvem

Uma pasta no Google Drive, compartilhada com quem exporta os BIs/planilhas,
contendo os arquivos abaixo (atualizados/sobrescritos todo dia):

| Arquivo esperado | Tabela | Vem de |
|---|---|---|
| `maquinas_diario.csv` | `maquinas_diario` | Indicadores de Produção (TMR, velocidade, apara, aderência) |
| `perdas_diario.csv` | `perdas_diario` | Perda Estratificada |
| `ops_diario.csv` | `ops_diario` | Refugo por OP |
| `wip_diario.csv` | `wip_diario` | Carteira x Produção |
| `carteira_diario.csv` | `carteira_diario` | Carteira x Produção |
| `apontamentos.csv` | `apontamentos` | Linha do Tempo (Gantt) |

As colunas de cada CSV precisam bater com as colunas da tabela em
`backend/schema_data.sql`. Se um export vier com nomes diferentes, me manda
um exemplo de linha que eu ajusto o `sync.js`.

## 3. Criar a conta de serviço do Google (acesso só-leitura)

1. [Google Cloud Console](https://console.cloud.google.com) → criar/usar um
   projeto → ativar a **Google Drive API**.
2. `IAM & Admin` → `Service Accounts` → `Create service account`.
3. Na conta criada → `Keys` → `Add key` → `JSON` → baixa um arquivo `.json`.
4. Compartilhe a pasta do Drive (passo 2) com o e-mail da conta de serviço
   (`nome@projeto.iam.gserviceaccount.com`), permissão **Leitor**.

## 4. Configurar os Secrets no GitHub

No repositório: `Settings` → `Secrets and variables` → `Actions` →
`New repository secret`. Criar quatro:

| Nome do secret | Valor |
|---|---|
| `SUPABASE_URL` | `https://iwocigbdywkypvagrrjk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `Project Settings > API > service_role` no Supabase — **secreta**, nunca aparece no navegador |
| `SYNC_DRIVE_FOLDER_ID` | ID da pasta do Drive (está na URL, depois de `/folders/`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | conteúdo **inteiro** do arquivo `.json` baixado no passo 3 (abra o arquivo, copie tudo, cole aqui) |

Esses valores ficam criptografados pelo GitHub e nunca aparecem em log,
mesmo se o workflow falhar.

## 5. Testar

- `Actions` (aba do repositório) → `Carga diária de dados de produção` →
  `Run workflow` → roda na hora, sem esperar o horário agendado.
- Depois, no Supabase: `select * from sync_log order by started_at desc limit 5;`
  mostra o histórico (status, linhas gravadas, erro se houver).

## 6. Agendamento

Já está configurado em `.github/workflows/sync-daily.yml` para rodar todo dia
às 06:00 UTC (03:00 horário de Brasília). Pra mudar o horário, edite a linha
`cron:` desse arquivo.

## Rodando localmente (opcional, pra testar antes de configurar os Secrets)

```bash
cd backend/sync
npm install
cp .env.example .env
# preencha o .env com os mesmos valores da tabela acima
# (use GOOGLE_APPLICATION_CREDENTIALS apontando pro .json local, em vez de
# GOOGLE_SERVICE_ACCOUNT_JSON)
npm run sync
```

## Próximo passo no front-end

Depois que a primeira carga rodar com sucesso, troco os arrays fixos
(`MAQUINAS`, `TIPOS_PERDA`, `APARAS_MENSAL` etc.) em `demo/index.html` por
`supabase.from(...).select(...)` — os gráficos e o layout continuam iguais,
só a origem do número muda.
