---
name: verificar-seguranca
description: Faz uma verificação de segurança exaustiva do projeto e das contas ligadas a ele — segredos no código e no histórico do git, chaves de API, backend, cookies e sessões, dependências, GitHub, permissões locais, e um roteiro guiado para conta Claude (login, sessões, dispositivos, Remote Control). Entrega um diagnóstico verde/amarelo/vermelho com ações explicadas para não-técnico, e já executa sozinha as correções seguras. Use quando o usuário pedir "verificar segurança", "auditoria de segurança", "estou seguro?", ou suspeitar de acesso indevido.
---

Auditoria de segurança do projeto Dito e das contas ligadas a ele.

O usuário **não é técnico**. Todo texto que sai para ele deve ser em português claro, sem jargão não explicado. O relatório final é o produto — o resto é trabalho interno.

## Regras invioláveis

1. **Nunca imprima um segredo inteiro.** Ao mostrar evidência de uma chave vazada, mascare: primeiros 4 e últimos 4 caracteres (`sk-a1b2…x9y0`). Isso vale para o relatório, para o terminal e para qualquer arquivo que você escrever.
2. **Nunca envie conteúdo do projeto para serviço externo** durante a auditoria (nada de colar código em API de terceiro, nada de publicar Artifact com segredo).
3. **Nunca invente um resultado.** Se um comando falhou ou uma verificação é impossível daqui, o relatório diz "não verificado" e explica por quê. Um "verde" falso é pior que um "não sei".
4. **Não rode nada destrutivo sozinho.** Ver a seção "O que você pode consertar sozinho".

## Fase 1 — Segredos no código e no histórico do git

O risco mais comum e mais grave. Uma chave commitada continua no histórico mesmo depois de apagada do arquivo.

```bash
# 1a. Algum arquivo sensível está sendo versionado agora?
git ls-files | grep -iE '\.env|credential|secret|\.pem$|\.key$|\.keystore$|\.jks$|keystore\.properties|serviceAccount'

# 1b. Segredos no código atual (ignora node_modules e build)
grep -rInE "(sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_|gho_|ghu_|ghs_|github_pat_|AIza[0-9A-Za-z_-]{30,}|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9|service_role|AKIA[0-9A-Z]{16}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=target --exclude-dir=__pycache__ 2>/dev/null | head -40

# 1c. Senha/token escrito direto no código (hardcoded)
grep -rInE "(password|senha|passwd|api[_-]?key|token|secret)\s*[:=]\s*['\"][^'\"]{8,}['\"]" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=__pycache__ \
  --include=*.py --include=*.js --include=*.ts --include=*.tsx --include=*.jsx --include=*.json --include=*.yml --include=*.yaml 2>/dev/null | head -30

# 1d. Histórico do git — segredo que já foi commitado algum dia
git log --all -p -S 'sk-ant-' --oneline 2>/dev/null | head -20
git log --all --diff-filter=A --name-only --format='%h %ad' --date=short -- '*.env' '*.key' '*.pem' '*credential*' '*.keystore' '*.jks' 2>/dev/null | head -30
```

Se `gitleaks` ou `trufflehog` estiverem instalados, rode também. Se não estiverem, **não instale** — os greps acima cobrem o essencial.

**Classificação:** segredo real no histórico ou em arquivo versionado = **VERMELHO**. Padrão suspeito que na inspeção é exemplo/placeholder/teste = **VERDE**, mas mencione. Segredo em arquivo local não versionado mas com permissão frouxa = **AMARELO**.

## Fase 2 — Chaves de API e o que vaza para o navegador

Tudo que vai para o frontend é **público** — qualquer visitante consegue ler. A pergunta certa não é "está escondido?", é "essa chave pode ser pública?".

```bash
# Variáveis expostas ao cliente no build do Vite
grep -rn "VITE_\|import.meta.env\|process.env" frontend/src 2>/dev/null | head -30
grep -rn "VITE_" .env 2>/dev/null | sed -E 's/=(.{4}).*(.{4})$/=\1…\2/'

# Chave que NUNCA pode estar no frontend
grep -rIn "service_role\|SERVICE_ROLE\|ANTHROPIC_API_KEY\|sk-ant-" frontend/src frontend/public 2>/dev/null

# Já foi para o bundle publicado?
grep -rIl "sk-ant-\|service_role" frontend/dist 2>/dev/null
```

Regra prática deste projeto:
- `anon key` do Supabase no frontend = **normal e esperado** (ela é pública por design; quem protege é o RLS).
- `service_role` do Supabase no frontend = **VERMELHO absoluto** (dá acesso total ao banco, ignora RLS).
- `ANTHROPIC_API_KEY` no frontend = **VERMELHO absoluto** (qualquer um gasta os créditos).

## Fase 3 — Backend, cookies e sessão

```bash
# CORS aberto para qualquer origem
grep -rIn "allow_origins\|CORSMiddleware\|Access-Control-Allow-Origin" backend 2>/dev/null

# Modo debug ligado em produção
grep -rIn "debug=True\|DEBUG = True\|reload=True" backend 2>/dev/null

# Como os cookies são criados — precisam de httponly + secure + samesite
grep -rIn "set_cookie\|Set-Cookie\|max_age\|httponly\|samesite" backend 2>/dev/null

# Endpoints sem verificação de autenticação
grep -rInE "@(app|router)\.(get|post|put|delete|patch)" backend 2>/dev/null | head -40
```

Para os endpoints listados, abra os que tratam dado de usuário e confirme que exigem autenticação. Um endpoint que recebe `user_id` como parâmetro **sem validar o token** deixa qualquer pessoa ler dados de qualquer usuário — isso é **VERMELHO**.

Cookie de sessão sem `httponly` = **AMARELO** (script malicioso consegue roubar a sessão). Sem `secure` em produção = **AMARELO**. `allow_origins=["*"]` junto com cookies de autenticação = **VERMELHO**.

## Fase 4 — Banco de dados (Supabase / RLS)

```bash
ls supabase/migrations 2>/dev/null | tail -20
grep -rIn "row level security\|RLS\|create policy\|enable row level" supabase 2>/dev/null | head -30
```

Toda tabela com dado de usuário precisa de RLS ligado **e** de política. Tabela exposta pela API sem RLS = **VERMELHO**. Se conseguir consultar o banco (ver a skill `deletauser` para a forma de conectar pelo pooler), confirme diretamente:

```sql
select schemaname, tablename, rowsecurity from pg_tables where schemaname='public' order by rowsecurity, tablename;
```

## Fase 5 — GitHub

```bash
gh auth status 2>&1 | head
gh repo view --json name,visibility,isPrivate,pushedAt 2>/dev/null
gh api repos/{owner}/{repo}/collaborators --jq '.[].login' 2>/dev/null
gh api repos/{owner}/{repo}/keys --jq '.[] | {title,read_only,created_at}' 2>/dev/null
gh secret list 2>/dev/null
gh api repos/{owner}/{repo}/actions/permissions 2>/dev/null
gh api repos/{owner}/{repo}/branches/main/protection 2>/dev/null | head -20
gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] | select(.state=="open")] | length' 2>/dev/null
grep -rn "pull_request_target\|workflow_run" .github/workflows 2>/dev/null
```

Interprete: repositório **público** com segredo no histórico = **VERMELHO** (já foi lido por robôs). Colaborador que o usuário não reconhece = **VERMELHO**. Deploy key com escrita, ou `pull_request_target` em workflow = **AMARELO**. Alertas do Dependabot abertos = **AMARELO** (some para vermelho se for vulnerabilidade crítica em dependência que roda em produção).

## Fase 6 — Dependências

```bash
cd frontend && npm audit --omit=dev 2>/dev/null | tail -25; cd ..
pip list --outdated 2>/dev/null | head -20
[ -f backend/requirements.txt ] && cat backend/requirements.txt
```

Vulnerabilidade **crítica ou alta** em dependência de produção = **AMARELO** (vira vermelho se houver exploit conhecido para o uso do projeto). Só em devDependencies = mencione, mas é verde.

## Fase 7 — Permissões e credenciais na máquina local

```bash
ls -la ~/.claude/.credentials.json 2>/dev/null
ls -la .env e2e/credentials.json 2>/dev/null
find . -name "*.keystore" -o -name "*.jks" -o -name "keystore.properties" 2>/dev/null | grep -v node_modules
cat .claude/settings.local.json 2>/dev/null
env | grep -iE "token|key|secret|password" | sed -E 's/=(.{4}).*/=\1…(oculto)/'
```

Arquivo com segredo legível por outros usuários (permissão diferente de `600`/`-rw-------`) = **AMARELO**. Chave de assinatura do Android (`.keystore`/`.jks`) versionada = **VERMELHO** (perder ou vazar essa chave compromete as atualizações do app na Play Store).

Cheque também `.claude/settings.local.json`: permissões amplas demais (como `Bash(*)` ou auto-aprovação de tudo) = **AMARELO**, porque removem a confirmação humana em ações destrutivas.

## Fase 8 — Conta Claude, sessões, dispositivos e Remote Control

**Isto você NÃO consegue verificar.** Não existe ferramenta nesta sessão que leia sessões ativas, histórico de login, dispositivos vinculados ou estado do Remote Control da conta Claude. Não invente, não deduza, não diga "parece ok".

O que você faz: guiar o usuário e **esperar a resposta dele**. Apresente assim, um bloco de cada vez, e peça que ele te conte o que viu:

> **Preciso da sua ajuda nesta parte — não tenho acesso à sua conta Claude.**
>
> 1. Abra **claude.ai** e clique no seu nome/avatar (canto inferior esquerdo) → **Settings**.
> 2. Em **Account**, veja qual é o método de login (Google ou código por e-mail) e se a verificação em duas etapas está ativa.
> 3. Procure a lista de **sessões ativas / dispositivos conectados**. Me diga quantos aparecem e se algum tem localização ou aparelho que você não reconhece.
> 4. Em **Settings → Connectors / Integrations**, veja quais serviços estão conectados (Google Drive, Gmail, Notion, Calendar). Me diga se algum está lá sem você ter autorizado.
> 5. Se você usa **Remote Control** no Claude Code, confirme se está ativo agora e se você reconhece as máquinas listadas.
> 6. Na sua conta **Google** ([myaccount.google.com/security](https://myaccount.google.com/security)): veja "Seus dispositivos" e "Atividade de segurança recente". Me diga se há algo estranho.

Além disso, no ambiente local dá para checar isto — que é objetivo e ajuda a interpretar as respostas:

```bash
ls -la ~/.claude/ 2>/dev/null
cat ~/.claude/settings.json 2>/dev/null
ls ~/.claude/projects/*/  -d 2>/dev/null | head
```

Marque o resultado desta fase como **NÃO VERIFICADO** enquanto o usuário não responder. No relatório, essa parte aparece como pendência, nunca como verde.

## O que você pode consertar sozinho

**Faça sem perguntar** (reversível, sem efeito colateral):
- Ajustar permissão de arquivo com segredo: `chmod 600 .env`, `chmod 600 e2e/credentials.json`, `chmod 600 ~/.claude/.credentials.json`
- Adicionar ao `.gitignore` um arquivo sensível que está fora dele (e avisar no relatório)
- Criar/corrigir `.env.example` sem valores reais
- Apertar flags de cookie no backend (`httponly=True`, `secure=True`, `samesite="lax"`) quando estiverem faltando
- Restringir `allow_origins=["*"]` para o domínio real do projeto

**Pergunte antes** (irreversível, derruba serviço, ou é decisão do usuário):
- Rotacionar/revogar qualquer chave de API — quebra o app em produção até a nova ser configurada
- Reescrever histórico do git (`filter-repo`, force-push) — afeta o repositório inteiro
- Tornar repositório público privado
- Remover colaborador ou deploy key
- Atualizar dependência com breaking change
- Qualquer `git push`

Ao terminar as correções automáticas, teste que nada quebrou (rode os testes se existirem) e liste no relatório exatamente o que você mudou.

## Formato do relatório final

Comece pelo veredito. Uma linha, em negrito, com o nível geral — que é sempre o **pior** nível encontrado em qualquer fase.

- 🟢 **VERDE** — nada encontrado. Diga o que foi verificado, para o "ok" ter peso.
- 🟡 **AMARELO** — risco potencial. Não houve invasão, mas existe porta mal fechada.
- 🔴 **VERMELHO** — risco real: segredo exposto, acesso indevido possível ou já ocorrido.

Depois, para cada achado (mais grave primeiro):

**1. [🔴/🟡] Título curto do problema**

*O que é:* explicação em 2-3 frases, sem jargão. Se precisar usar um termo técnico, defina na hora ("RLS, que é a regra que impede um usuário de ler dados de outro").

*Por que importa:* o que uma pessoa mal-intencionada conseguiria fazer com isso, em termos concretos ("conseguiria ler as transcrições de todos os usuários").

*Onde está:* arquivo e linha, como link clicável.

*O que fazer:* passos numerados, cada um uma ação única e literal. Diga em que site clicar, que botão apertar. Se envolver rotacionar chave, diga a ordem certa (gerar a nova → colocar no lugar → só então revogar a antiga) para o app não cair.

*Já resolvi:* o que você mesmo corrigiu, ou "nada — precisa da sua decisão".

Ao final, duas listas:
- **Corrigido automaticamente nesta verificação** (com o que mudou em cada arquivo)
- **Pendente com você** (em ordem de urgência, com estimativa de esforço: "2 minutos", "precisa de 15 minutos")

Se houver qualquer 🔴, a primeira linha do relatório deve dizer **o que fazer nos próximos 10 minutos** antes de qualquer explicação.
