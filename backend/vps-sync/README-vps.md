# Deploy da carga diária no VPS Hostinger

Este script (`sync.js`) roda todo dia no seu VPS via cron, lê os CSVs da pasta
combinada no Google Drive (BIs exportados + planilhas manuais) e grava no
Supabase Postgres — a peça "Hostinger VPS" do fluxo:

```
Planilhas/BIs (pasta na nuvem)
        │
        ▼
Hostinger VPS — script agendado (cron), roda todo dia   ←── você está aqui
        │
        ▼
Supabase Postgres — banco central único
        │
        ▼
Dashboard (GitHub Pages)
```

## 1. Acesso ao servidor

Assim que tiver o VPS, me passe (ou rode você mesmo seguindo os passos
abaixo):
- IP do servidor e usuário SSH (normalmente `root` no plano inicial da
  Hostinger).
- Confirmar que é Ubuntu/Debian (o painel da Hostinger deixa escolher a
  imagem — Ubuntu 22.04 é uma boa escolha se ainda não tiver decidido).

## 2. Preparar o servidor (uma vez só)

```bash
# atualizar pacotes
apt update && apt upgrade -y

# instalar Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# criar um usuário próprio pra rodar o script (evita rodar tudo como root)
adduser --disabled-password --gecos "" gualapack-sync
su - gualapack-sync
```

## 3. Criar a conta de serviço do Google (acesso só-leitura à pasta)

1. [Google Cloud Console](https://console.cloud.google.com) → criar um
   projeto (pode ser o mesmo se a empresa já usa GCP) → ativar a
   **Google Drive API**.
2. `IAM & Admin` → `Service Accounts` → `Create service account`.
3. Na conta criada → `Keys` → `Add key` → `JSON` → baixa um arquivo `.json`.
4. Compartilhe a pasta do Drive (a mesma com os CSVs) com o e-mail da conta
   de serviço (formato `nome@projeto.iam.gserviceaccount.com`), permissão
   **Leitor**.

## 4. Colocar o código no servidor

Do seu computador (ou direto no servidor via `git clone`, se o repo for
acessível):

```bash
# no servidor, como o usuário gualapack-sync
git clone https://github.com/FelipePanini/Dashboard-Gualapack.git
cd Dashboard-Gualapack/backend/vps-sync
npm install
```

Depois:
- Copie o `.json` da conta de serviço (passo 3) para dentro dessa pasta,
  ex: `service-account.json` (envie via `scp` do seu computador, nunca cole
  o conteúdo em um chat/e-mail).
- Copie `.env.example` para `.env` e preencha:
  ```bash
  cp .env.example .env
  nano .env
  ```
  - `SUPABASE_SERVICE_ROLE_KEY`: `Project Settings > API > service_role`
    no painel do Supabase — **essa chave é secreta**, nunca vai pro
    navegador nem pro git.
  - `SYNC_DRIVE_FOLDER_ID`: o ID da pasta do Drive (está na URL, depois de
    `/folders/`).
  - `GOOGLE_APPLICATION_CREDENTIALS`: caminho pro `.json` que você copiou
    (ex: `./service-account.json`).

## 5. Testar manualmente antes de agendar

```bash
npm run sync
```

Deve imprimir uma linha `[ok] ... -> tabela: N linhas` para cada CSV
encontrado. Confira também no Supabase:

```sql
select * from sync_log order by started_at desc limit 5;
```

## 6. Agendar no cron (todo dia, de madrugada)

```bash
crontab -e
```

Adicione (roda todo dia às 3h da manhã, horário do servidor):

```
0 3 * * * cd /home/gualapack-sync/Dashboard-Gualapack/backend/vps-sync && /usr/bin/node sync.js >> /home/gualapack-sync/sync.log 2>&1
```

Isso também grava um log local (`sync.log`) além do `sync_log` no banco —
útil se algo falhar antes mesmo de conseguir escrever no Supabase (ex: sem
internet no servidor).

## 7. Manutenção

- Atualizar o código depois de mudanças no repositório: `git pull` dentro da
  pasta `vps-sync`, depois `npm install` de novo se o `package.json` mudou.
- Ver o histórico de cargas: `select * from sync_log order by started_at desc;`
- Rodar fora do horário agendado a qualquer momento: `npm run sync`.

## 8. Segurança

- O `.env` e o `service-account.json` **nunca** devem ir para o git — o
  `.gitignore` do projeto já cobre `.env`; confirme que o `service-account.json`
  também não seja commitado (ele fica só no servidor).
- A `service_role key` do Supabase dá acesso total ao banco, ignorando RLS —
  por isso ela só existe no `.env` do servidor, nunca em código versionado.
