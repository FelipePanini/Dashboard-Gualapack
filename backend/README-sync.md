# Carga diária de dados reais — versão final do painel

Este documento explica a peça que falta pra sair de "dados de referência" para
"dados reais atualizados todo dia", conforme decidido: tudo (BIs exportados +
planilhas manuais) numa única pasta na nuvem, com uma rotina automática
buscando ali todo dia — sem ninguém precisar subir arquivo manualmente.

## Por que Google Drive

Entre nuvem própria (S3/Azure Blob) e Drive/OneDrive, uma pasta de
Drive/OneDrive é o caminho mais rápido porque:
- quem já mexe nos BIs/planilhas continua trabalhando do jeito que trabalha
  hoje, só salvando na pasta certa;
- não exige infraestrutura nova nem custo adicional (a empresa já deve ter
  Google Workspace ou Microsoft 365);
- a leitura automática usa só a API de leitura da pasta — nenhum acesso de
  escrita é necessário.

Este primeiro corte usa **Google Drive** porque a API é mais simples de
configurar sem depender de aprovação de administrador do Azure AD. Se a
empresa preferir manter tudo no ecossistema Microsoft (OneDrive/SharePoint),
a troca é só no arquivo `sync-daily/index.ts` — a Graph API faz o mesmo papel;
me avise que eu adapto.

## Como a carga funciona (visão geral)

```
Pasta na nuvem (BIs exportados em CSV + planilhas manuais)
        │  1x por dia, de madrugada
        ▼
pg_cron (dentro do Supabase) dispara a Edge Function "sync-daily"
        │
        ▼
sync-daily lê os CSVs da pasta, faz upsert nas tabelas de schema_data.sql
        │
        ▼
demo/index.html lê essas tabelas via supabase-js — números reais, não fictícios
```

Cada base vira **um CSV com nome fixo** dentro da mesma pasta (a exportação
desses CSVs a partir do Power BI/Excel é manual ou agendada por vocês — Power
BI e Excel têm "exportar/atualizar automaticamente" nativos; essa parte não
depende de mim). O `sync-daily` só lê o que estiver lá:

| Arquivo esperado na pasta | Tabela no banco | Vem de |
|---|---|---|
| `maquinas_diario.csv` | `maquinas_diario` | Indicadores de Produção (TMR, velocidade, apara, aderência) |
| `perdas_diario.csv` | `perdas_diario` | Perda Estratificada |
| `ops_diario.csv` | `ops_diario` | Refugo por OP |
| `wip_diario.csv` | `wip_diario` | Carteira x Produção |
| `carteira_diario.csv` | `carteira_diario` | Carteira x Produção |
| `apontamentos.csv` | `apontamentos` | Linha do Tempo (Gantt) |

As colunas de cada CSV precisam bater com as colunas da tabela em
`backend/schema_data.sql` (mesmo nome). Se um export vier com nomes
diferentes, me manda um exemplo de linha que eu ajusto o mapeamento no
`sync-daily`.

## Passo a passo de configuração (uma vez só)

1. **Rodar o schema de dados**
   - `SQL Editor` do Supabase → colar e rodar `backend/schema_data.sql`
     inteiro (depois do `schema.sql` já rodado antes).

2. **Criar a pasta única na nuvem**
   - Uma pasta no Google Drive (compartilhada com quem exporta os BIs/
     planilhas), com os arquivos `.csv` acima sendo sobrescritos/atualizados
     todo dia.

3. **Criar uma conta de serviço do Google (acesso só-leitura)**
   - Console do Google Cloud → criar um projeto → `IAM & Admin` →
     `Service Accounts` → `Create service account`.
   - Gerar uma chave JSON para essa conta de serviço.
   - Compartilhar a pasta do Drive (passo 2) com o e-mail da conta de serviço
     (é um e-mail tipo `nome@projeto.iam.gserviceaccount.com`), permissão
     **Viewer**.

4. **Publicar a Edge Function `sync-daily`**
   - Igual ao passo 3 do `README.md` principal (painel do Supabase →
     `Edge Functions` → `Deploy a new function` → nome exatamente
     `sync-daily` → colar `functions/sync-daily/index.ts`).
   - Em `Settings` da função, adicionar dois secrets:
     - `SYNC_DRIVE_FOLDER_ID`: o ID da pasta (está na URL do Drive, depois de
       `/folders/`).
     - `SYNC_GOOGLE_SERVICE_ACCOUNT`: cole o **conteúdo inteiro** do JSON da
       chave gerada no passo 3.
   - Não precisa desligar "Enforce JWT Verification" aqui — essa função não é
     chamada pelo navegador, só pelo agendador (próximo passo).

5. **Agendar a execução diária (pg_cron)**
   - No `SQL Editor`, rode uma vez (ajuste o horário — aqui 3h da manhã,
     horário do servidor é UTC, então `3h BRT = 6h UTC`):
     ```sql
     select cron.schedule(
       'sync-daily-producao',
       '0 6 * * *',
       $$
       select net.http_post(
         url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/sync-daily',
         headers := jsonb_build_object(
           'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
         )
       );
       $$
     );
     ```
   - Se as extensões `pg_cron` e `pg_net` não estiverem ativas, ative em
     `Database > Extensions` antes de rodar o comando acima.
   - Alternativa mais simples (sem mexer em `pg_cron`): usar o **Cron Trigger**
     nativo da própria tela de Edge Functions do Supabase (`Edge Functions >
     sync-daily > Cron`), que já oferece "rodar todo dia às HH:MM" sem SQL.

6. **Conferir que rodou**
   - `select * from sync_log order by started_at desc limit 5;` mostra o
     histórico (status `ok`/`error`, quantas linhas gravou, e o motivo em
     caso de erro).
   - Também dá pra disparar manualmente a qualquer momento clicando em
     `Invoke` na tela da função no painel do Supabase, sem esperar o horário.

## Próximo passo no front-end

Depois que a primeira carga rodar com sucesso, troco os arrays fixos
(`MAQUINAS`, `TIPOS_PERDA`, `APARAS_MENSAL` etc.) em `demo/index.html` por
`supabase.from(...).select(...)` — os gráficos e o layout continuam
exatamente iguais, só a origem do número muda. Aviso quando a carga estiver
validada pra fazer essa troca.
