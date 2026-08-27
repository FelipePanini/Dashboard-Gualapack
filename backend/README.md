# Backend de autenticação — Painel de Produção Gualapack

Este diretório contém tudo que roda **fora do navegador**: banco de dados,
regras de segurança e a função que valida a chave de convite antes de criar
uma conta. Nada aqui é enviado ao cliente — é o que transforma o painel de
"arquivo HTML estático" em uma aplicação com login de verdade.

Stack: [Supabase](https://supabase.com) (Postgres gerenciado + Auth). Plano
gratuito é suficiente para o volume de usuários de um painel interno.

## Por que não dava pra fazer isso só no front-end

Um `if (chave === "1234") { liberarCadastro() }` escrito em JavaScript fica
visível para qualquer pessoa que abrir "Ver código-fonte" no navegador — a
chave nunca fica secreta de verdade. Por isso o cadastro passa por um
servidor (Edge Function) que guarda a chave de acesso ao banco
(`service_role key`) numa variável de ambiente que o navegador nunca vê.

## Passo a passo (uma vez só)

1. **Criar o projeto**
   - Crie uma conta em [supabase.com](https://supabase.com) (pode usar login
     Microsoft, já que a empresa usa 365).
   - `New project` → escolha uma região (São Paulo, se disponível) → anote a
     senha do banco em local seguro.

2. **Rodar o schema**
   - No painel do projeto: `SQL Editor` → `New query`.
   - Cole o conteúdo de [`schema.sql`](./schema.sql) inteiro e rode.
   - Isso cria as tabelas `profiles` e `invite_keys`, ativa Row Level
     Security (RLS) e cria a função `validate_and_consume_invite`.

3. **Publicar a Edge Function `register`**
   - Instale a [Supabase CLI](https://supabase.com/docs/guides/cli).
   - `supabase login`
   - `supabase link --project-ref SEU_PROJECT_REF` (o ref aparece na URL do
     projeto: `supabase.com/dashboard/project/SEU_PROJECT_REF`)
   - `supabase functions deploy register --no-verify-jwt`
     (roda a partir da pasta `backend/`, que já tem `functions/register/index.ts`)
   - Configure o segredo que a função usa para falar com o banco:
     ```
     supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role key do projeto>
     ```
     A `service_role key` fica em `Project Settings > API`. **Nunca** cole
     esse valor em nenhum arquivo do front-end (`demo/*.html`, `*.js`).

4. **Preencher a configuração pública do front-end**
   - Abra [`demo/supabase-config.js`](../demo/supabase-config.js) e preencha:
     - `url`: `Project Settings > API > Project URL`
     - `anonKey`: `Project Settings > API > anon public key` (essa é
       segura para expor no navegador — o RLS que protege os dados)
     - `registerFunctionUrl`: `https://SEU_PROJECT_REF.functions.supabase.co/register`

5. **Gerar a primeira chave de convite**
   - No `SQL Editor`, rode (trocando a chave e o rótulo):
     ```sql
     insert into public.invite_keys (key_hash, label, role, max_uses, expires_at)
     values (
       crypt('uma-chave-forte-e-unica-aqui', gen_salt('bf')),
       'Convite inicial - Gestão de Produção',
       'admin',
       3,
       now() + interval '30 days'
     );
     ```
   - Guarde a chave em texto puro (ex: 1Password) e mande para quem for se
     cadastrar. Ela não pode ser recuperada depois — só o hash fica salvo.
   - `role` controla o que a pessoa pode fazer no painel mais adiante:
     `viewer` (só visualiza), `supervisor`, `manager`, `admin` (também gera
     convites).
   - `max_uses` permite uma chave "de equipe" (ex: 5 supervisores usam a
     mesma) ou uma chave de uso único (`max_uses = 1`).

6. **Testar**
   - Abra `demo/login.html` num servidor local (não `file://`, porque o
     `fetch` para a Edge Function precisa de origem http/https — use
     `npx serve demo` ou similar).
   - Cadastre-se com a chave gerada no passo 5, confirme que consegue
     entrar, e que `demo/index.html` redireciona para o login quando você
     não está autenticado (teste em uma aba anônima).

## O que cada camada de segurança está fazendo

| Camada | Onde | Protege contra |
|---|---|---|
| Chave de convite com hash (`pgcrypto`) | Postgres | Cadastro aberto — sem chave válida, `createUser` nunca é chamado |
| `validate_and_consume_invite` como `SECURITY DEFINER` + `revoke execute` do público | Postgres | Alguém chamar a validação da chave direto pela API, pulando a Edge Function |
| Incremento atômico de `used_count` | Postgres | Duas pessoas usando a mesma chave "de uso único" ao mesmo tempo (race condition) |
| `service_role key` só na Edge Function | Supabase secrets | Qualquer chave de administrador do banco vazar pelo navegador |
| Row Level Security em todas as tabelas | Postgres | Qualquer usuário ler/editar dados fora do que a policy permite, mesmo com a `anon key` em mãos |
| Rate limit por IP na Edge Function | Deno | Tentativas de força bruta contra a chave de convite |
| Senha mínima de 12 caracteres | Edge Function | Contas com senha fraca |
| Painel (`index.html`) checa sessão antes de renderizar | Front-end (UX) | Alguém sem login ver a tela — a proteção *real* dos dados é o RLS acima, isso é só para não "piscar" dado sensível |

## Próximos passos sugeridos

- Trocar a tela de convite única por um painel de administração (listar,
  revogar e gerar chaves sem precisar do SQL Editor) — dá pra construir como
  uma nova aba do próprio painel, restrita a `role = 'admin'`.
- Quando conectarmos o SharePoint/Microsoft Graph, avaliar login único via
  Azure AD (Entra ID) como alternativa ao e-mail/senha, já que a empresa
  usa Microsoft 365 — mantém tudo no mesmo diretório de usuários da empresa.
- Ativar MFA (autenticação em duas etapas) no Supabase Auth antes de ligar
  isso pra produção com dados reais.
