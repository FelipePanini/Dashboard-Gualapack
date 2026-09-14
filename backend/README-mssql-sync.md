# Carga direta do SQL Server — passo a passo (runner no seu PC)

Elimina o upload manual pras planilhas que vêm da view
`View_usr_apontamentos_999999` e afins no SQL Server `Metrics`
(`sbrjag-db.br.gpk.gpk-grp.local`, também acessível pelo IP `192.168.1.8`
— é a mesma máquina). Mapeamento completo de onde cada planilha vinha:
ver a conversa de 2026-09-11 ou `docs/mapeamento/`.

```
SQL Server (rede interna da Gualapack, só VPN/rede corporativa)
        │
        ▼
Seu PC — runner do GitHub Actions rodando em modo interativo
         (sem precisar de admin — ver Passo 3)
        │
        ▼
GitHub Actions — o workflow roda igual aos outros, só que a etapa que
        fala com o SQL Server executa no seu PC em vez da nuvem do GitHub
        │
        ▼
Supabase — mesmas tabelas de sempre (apontamentos, producao_kg, + 2 novas)
        │
        ▼
Dashboard atualizado
```

Por que não dá pra rodar na nuvem do GitHub como o `sync-drive.yml` de
hoje: `sbrjag-db.br.gpk.gpk-grp.local` é um nome de domínio interno, só
resolvível/alcançável de dentro da rede ou VPN da Gualapack. O runner
"self-hosted" é a forma oficial do GitHub de rodar um workflow numa
máquina sua em vez da deles — o workflow continua aparecendo na mesma
aba Actions, com os mesmos secrets e o mesmo histórico de logs.

**Seu login é integrado do Windows/domínio** (sem senha separada do SQL
Server). Duas formas de automatizar isso, e escolhemos a que **não pede
instalar nada** além do Node:

| | Driver `msnodesqlv8` | NTLM via `mssql` (escolhido) |
|---|---|---|
| Instala | ODBC Driver + Build Tools do Visual Studio (3-6 GB) | nada além do Node |
| Credencial | nenhuma — herda a sessão do Windows | seu usuário + senha de domínio, como GitHub Secret |
| Serviço do runner | precisa rodar com seu usuário do Windows | pode ficar como está (Local System) |

`mssql` é um pacote JavaScript puro (mesma categoria de dependência que
`googleapis`/`xlsx`, já usados neste projeto) — sem compilação nativa,
sem instalar driver ODBC. O trade-off é guardar seu usuário/senha de
domínio num GitHub Secret (criptografado, nunca aparece no código) em
vez de a autenticação vir de graça pela sessão. Se um dia preferir
separar isso da sua conta pessoal, dá pra pedir ao TI um login de SQL
Server dedicado — é uma troca pequena de configuração, não muda nada
na arquitetura.

Siga os passos **na ordem**.

---

## Passo 1 — Node.js sem precisar de admin (5 min)

O instalador normal do Node pede permissão de administrador. Sem isso,
use a versão **portátil** (zip, sem instalador — só descompacta e usa):

1. Baixe o "Windows Binary (.zip)" da versão **LTS** em
   [nodejs.org/en/download](https://nodejs.org/en/download) (role até
   achar a linha com `.zip`, não o `.msi`).
2. Descompacte em uma pasta sua, sem precisar de admin — por exemplo
   `C:\Users\SEU_USUARIO\node`. Dentro dela tem o `node.exe` direto.
3. Adiciona essa pasta ao PATH **só do seu usuário** (não pede admin,
   diferente de mexer no PATH do sistema todo) — no PowerShell:
   ```powershell
   [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Users\SEU_USUARIO\node", "User")
   ```
4. Feche e abra o PowerShell de novo, confirme: `node --version` deve
   mostrar `v22...`. Se não achar o comando, feche e abra de novo (o
   PATH só atualiza em janelas novas).

## Passo 2 — (pulado) — sem driver nativo, sem instalação extra

Com NTLM via `mssql` não precisa de ODBC Driver nem de Build Tools —
o `npm install` do Passo 6 já traz tudo que falta.

## Passo 3 — Instalar o runner do GitHub Actions no seu PC (10 min)

Instalar como **serviço do Windows** (o jeito "de fundo", que sobrevive
a reinício) pede admin (`sc create` por baixo dos panos). Sem admin,
o runner roda **em modo interativo** — uma janela aberta (pode
minimizar) enquanto você quiser que o sync tenha chance de rodar. Isso
já é coerente com o que você me disse antes: sem máquina dedicada, o
job só roda quando seu PC está ligado e conectado mesmo.

1. No repositório do GitHub, vá em **Settings → Actions → Runners** →
   **New self-hosted runner** → escolha **Windows** / **x64**.
2. O GitHub mostra um bloco de comandos PowerShell pra copiar e colar —
   siga exatamente o que aparecer lá (baixa o runner, extrai, roda
   `.\config.cmd`). Isso **não** pede admin, só registra o runner com um
   token de uso único. Quando pedir **labels**, pode deixar o padrão
   (`self-hosted`, `Windows`, `X64`).
3. Pra ligar o runner, roda (sem instalar como serviço):
   ```powershell
   .\run.cmd
   ```
   Deixa essa janela aberta (pode minimizar) — é ela que faz o runner
   ficar "escutando" por jobs do GitHub. Fechando a janela, o runner
   para; da próxima vez que quiser que o sync rode, roda `.\run.cmd` de
   novo na mesma pasta.
4. Confirme em **Settings → Actions → Runners** no GitHub que ele
   aparece como **Idle** (verde) enquanto a janela estiver aberta.

**Dica pra não ter que abrir isso na mão todo dia:** cria um atalho pro
`run.cmd` na pasta **Inicializar** do Windows
(`shell:startup` na caixa Executar) — daí ele abre sozinho toda vez que
você liga o PC e faz login, sem precisar de admin pra isso.

## Passo 4 — Testar a conexão com o SQL Server manualmente (2 min)

Antes de mexer no workflow, confirma que seu PC realmente alcança o
banco (precisa estar na rede/VPN da empresa):

```powershell
Test-NetConnection -ComputerName sbrjag-db.br.gpk.gpk-grp.local -Port 1433
```

`TcpTestSucceeded : True` = alcançou. Se der `False`, confirme que está
conectado na VPN/rede da Gualapack antes de continuar.

## Passo 5 — Rodar o schema novo no Supabase

`SQL Editor` do Supabase → colar e rodar
[`backend/schema_mssql.sql`](./schema_mssql.sql) (cria as 2 tabelas
novas: `producao_metros` e `programacao_futura`).

## Passo 6 — Cadastrar os secrets no GitHub

`Settings → Secrets and variables → Actions → New repository secret`
(esses secrets ficam disponíveis pra qualquer runner, inclusive o seu —
não precisa cadastrar de novo em outro lugar):

- `MSSQL_DOMAIN` — o domínio do Windows (a parte antes da barra no seu
  login, ex: `BR` ou `GPK`, o que vier antes de `\seu.usuario`)
- `MSSQL_USER` — seu usuário de domínio, sem o domínio junto (só
  `seu.usuario`, sem `DOMINIO\` na frente)
- `MSSQL_PASSWORD` — sua senha de domínio
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (já devem existir, dos
  outros workflows — confirme se aparecem na lista, senão cadastra de
  novo)

Sua senha de domínio guardada num secret do GitHub fica criptografada e
só é exposta durante a execução do workflow no SEU PC — nunca trafega
pra fora dele nem aparece em log. Ainda assim, se sua senha de domínio
mudar (troca periódica obrigatória, por exemplo), lembre de atualizar
esse secret, senão o sync começa a falhar silenciosamente até você
notar.

## Passo 7 — Testar manualmente

No GitHub: **Actions** → **Carga direta do SQL Server** → **Run
workflow**. Acompanha o log — como agora ele roda no seu PC, dá pra ver
o processo também na janela do runner, se estiver aberta.

## Passo 8 — Pronto, roda sozinho

O `schedule` no workflow já está configurado pra rodar todo dia de
madrugada, igual ao `sync-drive.yml`. Como o runner é interativo (Passo
3), ele só está "escutando" enquanto a janela do `run.cmd` estiver
aberta — com o atalho na pasta Inicializar, isso acontece sozinho todo
login. Se o PC estiver desligado ou a janela fechada no horário
agendado, o job fica na fila e roda assim que o runner voltar a ficar
online (não pula o dia silenciosamente, mas também não é garantido no
horário exato).
