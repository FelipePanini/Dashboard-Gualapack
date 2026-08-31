# Dados reais — upload direto pelo painel

Sem SharePoint automático, sem Power Automate, sem app registrado no Azure.
Quem atualiza os dados faz isso **de dentro do próprio painel**, arrastando
a planilha do dia — o mesmo login de admin que já existe.

```
Planilha (exportada de onde for)
        │
        ▼
demo/upload.html — admin arrasta o arquivo, sistema já logado
        │
        ▼
Função "ingest" no Supabase — lê a planilha e grava no banco central
        │
        ▼
Dashboard já mostra o dado novo
```

## 1. Rodar os schemas no Supabase (uma vez só)

`SQL Editor` do Supabase → colar e rodar, nesta ordem:
1. `backend/schema.sql` (se ainda não rodou)
2. `backend/schema_data.sql`

## 2. Publicar a função `ingest`

- Painel do Supabase → `Edge Functions` → `Deploy a new function`.
- Nome: **`ingest`** (exatamente esse).
- Cole o conteúdo de [`functions/ingest/index.ts`](./functions/ingest/index.ts).
- Não precisa configurar nenhum secret novo — `SUPABASE_URL` e
  `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente em toda Edge
  Function do projeto.
- Mantenha **"Enforce JWT Verification" ligado** (é o padrão) — essa função
  agora exige que quem chama esteja logado, e checa dentro do código se a
  pessoa tem `role = admin` antes de gravar qualquer coisa.

## 3. Usar a tela de upload

- Acesse `demo/upload.html` (ou clique no ícone de seta-pra-cima na barra
  lateral do painel — só aparece pra quem é admin).
- Pra cada indicador (Máquinas, Perdas, OPs, WIP, Carteira, Apontamentos),
  arraste o arquivo `.xlsx`/`.xls`/`.csv` correspondente no card certo, ou
  clique em "Escolher arquivo".
- A primeira linha da planilha precisa ser o cabeçalho (nome das colunas),
  com dados a partir da linha 2 — não precisa ser Tabela do Excel, não
  precisa de nome de arquivo específico (você escolhe o indicador pelo
  card, não pelo nome do arquivo).
- Cada card mostra na hora se deu certo (quantas linhas gravou) ou o motivo
  do erro (geralmente nome de coluna que não bate com o banco).

## 4. Nomes de coluna esperados

As colunas da planilha (linha 1) precisam ter os mesmos nomes das colunas
das tabelas em `backend/schema_data.sql` (acentos e maiúsculas não importam
— `TMR (%)` e `tmr` são tratados como iguais).

| Card | Tabela | Colunas |
|---|---|---|
| Máquinas (diário) | `maquinas_diario` | `data_ref`, `maquina_id`, `tmr`, `vel_media`, `aparas_pct`, `perda_confirm_pct`, `horas_prod`, `horas_tot`, `plan_km`, `real_km` |
| Perdas (diário) | `perdas_diario` | `data_ref`, `tipo_perda`, `maquina_id`, `kg` |
| Ordens de produção | `ops_diario` | `data_ref`, `op`, `maquina_id`, `descricao`, `peso_bruto_kg`, `refugo_kg`, `apara_pct`, `motivo_principal` |
| WIP | `wip_diario` | `data_ref`, `etapa`, `cliente`, `classificacao`, `dentro_carteira`, `metros` |
| Carteira | `carteira_diario` | `data_ref`, `classificacao`, `carteira_kg`, `produzido_kg`, `faturado_kg` |
| Apontamentos | `apontamentos` | `maquina_id`, `status`, `op`, `inicio`, `fim` |

Se as planilhas reais tiverem nomes de coluna diferentes, me diga os nomes
reais que eu ajusto o schema pra bater — mais simples que pedir pra
reformatar as planilhas que o time já usa.

## 5. Conferir que funcionou

No Supabase, `SQL Editor`:
```sql
select * from sync_log order by started_at desc limit 10;
select * from maquinas_diario order by data_ref desc limit 10;
```

## 6. Sobre ser "manual"

Isso não é 100% automático — alguém precisa abrir a tela e arrastar os
arquivos, uma vez por dia (leva menos de um minuto). É o nível de automação
que dá pra ter agora sem depender de acesso de TI/admin no Microsoft 365.
Se um dia a TI liberar o registro de um aplicativo no Entra ID, dá pra trocar
essa etapa manual por uma leitura automática do SharePoint sem jogar nada
fora — a função `ingest` e o banco continuam os mesmos, só muda quem chama.

## Próximo passo no front-end

Depois que a primeira carga rodar com sucesso, troco os arrays fixos
(`MAQUINAS`, `TIPOS_PERDA`, `APARAS_MENSAL` etc.) em `demo/index.html` por
`supabase.from(...).select(...)` — os gráficos e o layout continuam iguais,
só a origem do número muda.
