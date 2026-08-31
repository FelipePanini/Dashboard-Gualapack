# Carga automática via Google Drive (conta pessoal) — passo a passo

Sem depender de TI, sem app no Azure, sem admin da Gualapack. Usa a pasta do
Google Drive **pessoal** que você já conectou nesta conversa. Uma conta de
serviço do Google (self-service, você mesmo cria) lê essa pasta todo dia e
grava no banco — automático de verdade.

```
Planilhas no SharePoint (fonte original, na empresa)
        │  você copia pra essa pasta pessoal (trabalho manual que continua existindo)
        ▼
Google Drive pessoal — pasta já conectada
        │
        ▼
GitHub Actions — roda sozinho todo dia às 3h (horário de Brasília)
        │
        ▼
Supabase — grava nas tabelas (mesmo schema de sempre)
        │
        ▼
Dashboard atualizado
```

Siga os passos **na ordem**, sem pular — cada um depende do anterior.

---

## Passo 1 — Criar um projeto no Google Cloud (5 min)

1. Abra [console.cloud.google.com](https://console.cloud.google.com) e entre
   com a **mesma conta Google** dona da pasta do Drive (a que você usou pra
   me dar acesso).
2. No topo da página, clique no seletor de projeto (ao lado do logo "Google
   Cloud") → **New Project**.
3. Nome do projeto: `gualapack-painel-sync` (pode ser outro nome, não
   importa). Deixe "Organization" e "Location" como estão.
4. Clique **Create** e espere uns 10-20 segundos até o projeto ser criado.
   Confirme que o seletor de projeto no topo mostra o nome novo — se não
   mostrar, clique nele de novo e selecione o projeto criado.

## Passo 2 — Ativar a API do Google Drive (2 min)

1. Com o projeto certo selecionado, vá em
   [console.cloud.google.com/apis/library](https://console.cloud.google.com/apis/library).
2. Na busca, digite `Google Drive API` e clique no resultado.
3. Clique no botão azul **Enable**. Espere carregar (alguns segundos).

## Passo 3 — Criar a conta de serviço (5 min)

1. Vá em
   [console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   (confira de novo que o projeto certo está selecionado no topo).
2. Clique **+ Create Service Account**.
3. Preencha:
   - **Service account name**: `painel-sync`
   - (o **Service account ID** preenche sozinho, ex: `painel-sync@gualapack-painel-sync.iam.gserviceaccount.com` — **copie/anote esse e-mail**, vai precisar dele no Passo 5)
4. Clique **Create and Continue**.
5. Na tela "Grant this service account access to project" (passo 2 de 3),
   **não selecione nenhuma role** — deixe em branco. Clique **Continue**.
6. Na tela seguinte (passo 3 de 3), também deixe em branco. Clique **Done**.

## Passo 4 — Gerar a chave (arquivo JSON) da conta de serviço (3 min)

1. Ainda em **IAM & Admin > Service Accounts**, clique na conta que você
   acabou de criar (`painel-sync@...`).
2. Vá na aba **Keys** (no topo da página).
3. Clique **Add Key** → **Create new key**.
4. Tipo: **JSON** (já vem marcado por padrão) → **Create**.
5. Um arquivo `.json` é baixado automaticamente pro seu computador (algo
   como `gualapack-painel-sync-xxxxx.json`). **Guarde esse arquivo com
   cuidado** — quem tiver ele consegue ler a pasta do Drive compartilhada.
   Não é preciso subir ele pra lugar nenhum ainda, só guardar por enquanto.

## Passo 5 — Compartilhar a pasta do Drive com a conta de serviço (2 min)

1. Abra a pasta do Drive no navegador (a mesma que você já compartilhou
   comigo): `drive.google.com/drive/folders/191x0GBpe6EX5srUFOzbzoUDAvi7JaUSZ`
2. Clique com o botão direito na pasta (ou no botão **Share** se estiver
   dentro dela) → **Share**.
3. No campo de e-mail, cole o e-mail da conta de serviço que você anotou no
   Passo 3 (termina em `.iam.gserviceaccount.com`).
4. Permissão: **Viewer** (leitor) é suficiente — ela só precisa ler, nunca
   escrever.
5. Desmarque a opção de notificar por e-mail (a conta de serviço não lê
   e-mail) e clique **Share**/**Send**.

## Passo 6 — Anotar o ID da pasta

Já temos: no link da pasta, o ID é o trecho depois de `/folders/`:

```
DRIVE_FOLDER_ID = 191x0GBpe6EX5srUFOzbzoUDAvi7JaUSZ
```

## Passo 7 — Rodar os schemas no Supabase (se ainda não rodou)

`SQL Editor` do Supabase → rode, nesta ordem, se ainda não rodou:
1. `backend/schema.sql`
2. `backend/schema_data.sql`

## Passo 8 — Cadastrar os secrets no GitHub (5 min)

No repositório do painel: `Settings` → `Secrets and variables` → `Actions` →
`New repository secret`. Criar **quatro**:

| Nome do secret | Valor |
|---|---|
| `SUPABASE_URL` | `https://iwocigbdywkypvagrrjk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → `Project Settings` → `API` → `service_role` (chave secreta) |
| `DRIVE_FOLDER_ID` | `191x0GBpe6EX5srUFOzbzoUDAvi7JaUSZ` (Passo 6) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | conteúdo **inteiro** do arquivo `.json` baixado no Passo 4 — abra o arquivo num editor de texto, selecione tudo, copie e cole aqui |

Pra colar o JSON certo: abra o arquivo `.json` baixado (pode ser no Bloco de
Notas/TextEdit), `Ctrl+A` → `Ctrl+C`, cole inteiro no campo de valor do
secret no GitHub. Não precisa editar nada nele.

## Passo 9 — Renomear/organizar os arquivos na pasta do Drive

O sistema identifica cada planilha **pelo nome do arquivo** — o nome
precisa *conter* uma dessas palavras (maiúscula/minúscula e acento não
importam):

| Palavra no nome do arquivo | Vira a tabela |
|---|---|
| `sequenciamento` | `fardos_aparas` |
| `aderencia_maquinas` ou `aderência máquinas` | `aderencia_maquinas_diaria` |
| `historico_aderencia` ou `histórico aderência` | `aderencia_programacao` |
| `refugo_aparas` ou `refugo aparas` | `refugo_aparas_historico` |
| `tendencia` ou `grafico`/`gráfico` | `tendencia_mensal` |
| `machine_card` ou `machine card` | `maquinas` |
| `indicadores` ou `base_aparas`/`base aparas` | `apontamentos` |

Os nomes reais das suas planilhas (ex: "Indicadores Diário - 2026.xlsx",
"08. SEQUENCIAMENTO DOS FARDOS DE APARAS JGR - Agosto 2026.xlsx") já batem
naturalmente com essas palavras — não precisa renomear nada na maioria dos
casos.

**Planilhas grandes/com várias abas** (Indicadores Diário, Base Aparas,
Machine Card, Histórico Aderência Programação — 15 a 100 MB): o script já
lê só a aba certa automaticamente, então **pode subir o arquivo original
inteiro** nessa pasta, sem precisar cortar com `tools/planilha-uma-aba.js`
primeiro — essa ferramenta continua útil só se você quiser reduzir o
tamanho por outro motivo (ex: espaço, velocidade de upload).

## Passo 10 — Testar manualmente

1. No repositório: aba **Actions** → **Carga diária de dados de produção
   (Google Drive)** → **Run workflow** → **Run workflow** (botão verde).
2. Espere terminar (ícone fica verde ✅ ou vermelho ❌ — clique no run pra
   ver o log linha por linha se der erro).
3. Confira no Supabase:
   ```sql
   select * from sync_log order by started_at desc limit 5;
   ```
   A coluna `detalhe` mostra quais arquivos foram lidos e quantas linhas
   cada um gravou (ou o erro exato, se algo falhou).

## Passo 11 — Pronto, roda sozinho

O workflow já está agendado pra rodar **todo dia às 3h da manhã** (horário
de Brasília) — não precisa fazer mais nada depois que o teste manual (Passo
10) funcionar. `demo/upload.html` continua existindo como opção manual, pra
emergências ou pra subir algo fora do horário.

---

## Erros comuns

| Mensagem | Causa provável | Solução |
|---|---|---|
| `Faltando variável de ambiente: ...` | Algum secret não foi criado ou o nome está diferente do esperado | Confira os 4 nomes exatos no Passo 8 |
| `Não consegui listar a pasta` / erro 403/404 | A pasta não foi compartilhada com o e-mail certo | Repita o Passo 5, confirme que copiou o e-mail `...iam.gserviceaccount.com` certo |
| Arquivo aparece como "skip" no log | O nome do arquivo não contém nenhuma palavra-chave da tabela | Renomeie o arquivo incluindo uma das palavras do Passo 9 |
| `está vazia` | A aba detectada não tem os dados esperados | Confira se a planilha tem a aba certa (ver `backend/README-dados.md`) |
