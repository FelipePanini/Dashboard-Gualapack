# backend/

Tudo que roda fora do navegador. Visão geral e decisões no
[README da raiz](../README.md).

| Pasta | O que tem | Onde roda |
|---|---|---|
| [`sql/`](./sql/) | `schema.sql` (login, perfis, convites) → `schema_data.sql` (tabelas dos dados) → `schema_views.sql` (funções e views que o painel lê). Rodar nessa ordem. | Supabase, SQL Editor |
| [`sync-drive/`](./sync-drive/) | A carga diária: `build-database-central.js` (etapa 1), `sync.js` (etapa 2), `lib.js` (regras de arquivo/aba/coluna), `lib.test.js`. `bases-catalog.js` + `collect-bases.js` montam as abas de inventário do arquivo central. | GitHub Actions |
| [`functions/register/`](./functions/register/) | Cadastro com chave de convite (publicada no Supabase como `super-action`). | Supabase Edge Functions |
| [`functions/ingest/`](./functions/ingest/) | Upload manual — **legado**, ver [docs/guias/upload-manual.md](../docs/guias/upload-manual.md). | Supabase Edge Functions |

## Rodar a carga no seu computador

```bash
cd backend/sync-drive
npm ci
npm test            # regras de leitura, sem rede nem credencial
```

As ferramentas temporárias da fase de investigação (`inspect-all.js`,
`validar-base-apontamento.js`, `extract-power-query.js` e os workflows delas)
saíram do repositório em 23/09/2026. O resultado delas está em
`docs/mapeamento/`, e o código continua no histórico do git se precisar rodar
de novo.

`npm run build` e `npm run sync` precisam das mesmas variáveis de ambiente que
os workflows recebem dos GitHub Secrets (`DRIVE_FOLDER_ID`,
`GOOGLE_SERVICE_ACCOUNT_JSON`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
Nunca grave esses valores num arquivo dentro do repositório.
