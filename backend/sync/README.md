# Carga diária de dados reais — SharePoint + GitHub Actions

Sem servidor próprio: a carga diária roda de graça no **GitHub Actions**, o
mesmo lugar que já hospeda o site. Lê os CSVs (BIs exportados + planilhas
manuais) de uma pasta do SharePoint e grava no Supabase Postgres.

```
Planilhas/BIs (pasta no SharePoint)
        │
        ▼
GitHub Actions — roda "sync.js" todo dia (cron nativo, .github/workflows/sync-daily.yml)
        │  (via Microsoft Graph API)
        ▼
Supabase Postgres — banco central único (dados + auth + RLS)
        │
        ▼
Dashboard (GitHub Pages)
```

## 1. Rodar o schema de dados (uma vez só)

`SQL Editor` do Supabase → colar e rodar `backend/schema_data.sql` (depois de
`schema.sql`, já rodado antes).

## 2. Pasta no SharePoint

Você já criou a pasta pessoal — o link que você mandou
(`.../personal/felipe_panini_gualapack_com/...`) é uma pasta do **OneDrive/
SharePoint pessoal**, o que já funciona. Nela, os arquivos abaixo devem ser
atualizados/sobrescritos todo dia (export do BI ou planilha salva com esse
nome exato):

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

> Nota: uma pasta **pessoal** (`/personal/...`) funciona, mas se outras
> pessoas do time também vão alimentar as planilhas, uma pasta de um **site**
> de equipe do SharePoint (ex: um site "Produção JGR") é mais robusta —
> sobrevive a troca de usuário e todo mundo edita no mesmo lugar sem depender
> da sua conta pessoal continuar existindo. Fica a seu critério.

## 3. Registrar o app no Microsoft Entra ID (acesso automático, sem login humano)

O Graph precisa de um "aplicativo" com permissão de leitura no site, pra
buscar os arquivos sozinho todo dia sem ninguém logar manualmente.

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** →
   `App registrations` → `New registration`.
   - Nome: `Painel Producao - Sync`. Tipo de conta: só essa organização.
2. Anote, na tela `Overview` do app recém-criado:
   - **Application (client) ID** → vira `MS_CLIENT_ID`
   - **Directory (tenant) ID** → vira `MS_TENANT_ID`
3. `Certificates & secrets` → `New client secret` → gera e **copie o valor**
   na hora (some depois) → vira `MS_CLIENT_SECRET`.
4. `API permissions` → `Add a permission` → `Microsoft Graph` →
   **Application permissions** (não "Delegated") → marque `Sites.Read.All`
   → `Add permissions`.
5. Na mesma tela, clique em **"Grant admin consent"** (precisa ser feito por
   um admin do Microsoft 365 da empresa — sem isso a permissão fica pendente
   e o app não consegue ler nada).

## 4. Descobrir o `SHAREPOINT_SITE` e `SHAREPOINT_FOLDER_PATH`

- `SHAREPOINT_SITE`: para uma pasta pessoal como a que você criou, o formato é
  `gualapackspa-my.sharepoint.com:/personal/felipe_panini_gualapack_com`
  (troque `gualapackspa-my.sharepoint.com` pelo domínio real que aparece na
  barra de endereço, e o final é o mesmo trecho depois de `/personal/` na
  URL que você mandou).
- `SHAREPOINT_FOLDER_PATH`: o caminho da pasta dentro da biblioteca. Para
  OneDrive pessoal costuma ser algo como
  `Documents/<nome da pasta que você criou>`. Se não tiver certeza, me diga
  o nome exato da pasta que você criou (o que aparece na barra lateral,
  não a URL) que eu ajudo a confirmar o caminho certo.

## 5. Configurar os Secrets no GitHub

No repositório: `Settings` → `Secrets and variables` → `Actions` →
`New repository secret`. Criar seis:

| Nome do secret | Valor |
|---|---|
| `SUPABASE_URL` | `https://iwocigbdywkypvagrrjk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `Project Settings > API > service_role` no Supabase — **secreta** |
| `MS_TENANT_ID` | do passo 3.2 |
| `MS_CLIENT_ID` | do passo 3.2 |
| `MS_CLIENT_SECRET` | do passo 3.3 — **secreta** |
| `SHAREPOINT_SITE` | do passo 4 |
| `SHAREPOINT_FOLDER_PATH` | do passo 4 |

## 6. Testar

- `Actions` (aba do repositório) → `Carga diária de dados de produção` →
  `Run workflow` → roda na hora, sem esperar o horário agendado.
- No Supabase: `select * from sync_log order by started_at desc limit 5;`
  mostra o histórico (status, linhas gravadas, erro se houver).

## 7. Agendamento

Já configurado em `.github/workflows/sync-daily.yml` para rodar todo dia às
06:00 UTC (03:00 horário de Brasília). Pra mudar o horário, edite a linha
`cron:` desse arquivo.

## Rodando localmente (opcional, pra testar antes de configurar os Secrets)

```bash
cd backend/sync
npm install
cp .env.example .env
# preencha o .env com os mesmos valores da tabela acima
npm run sync
```

## Próximo passo no front-end

Depois que a primeira carga rodar com sucesso, troco os arrays fixos
(`MAQUINAS`, `TIPOS_PERDA`, `APARAS_MENSAL` etc.) em `demo/index.html` por
`supabase.from(...).select(...)` — os gráficos e o layout continuam iguais,
só a origem do número muda.
