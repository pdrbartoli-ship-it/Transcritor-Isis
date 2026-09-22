# Dito: auditoria de aparência e plano para parecer profissional

Data: 19/09/2026. Escopo: landing page e app (web, Android e Windows usam o mesmo frontend).
Como foi feita: leitura de todo o código de interface (`frontend/src`, `index.html`, `public/*.html`), dos prompts da IA (`backend/main.py`) e capturas de tela da produção em desktop e celular (landing, login, home, conversa, modal de plano).

## Resumo

O que mais entrega "feito por IA", em ordem de peso:

1. **A cara inteira é uma cópia do Claude.ai.** Fundo creme `#faf9f5`, terracota `#c96442`, títulos em serifa, e o código chega a dizer que o Inter é "a substituta documentada da StyreneB" (a fonte do Claude). Quem conhece o Claude reconhece na hora. Para um produto que quer passar confiança a médicos, psicólogos e advogados, é o maior sinal de "template".
2. **Duas famílias de fonte brigando.** Serifa (Source Serif 4) em 17 lugares do app, incluindo rótulos pequenos de 15px ao lado de texto Inter de 12px. É o que você percebeu no "O que vamos registrar hoje?".
3. **Texto de robô.** Cerca de 36 travessões no que o usuário lê, frases de efeito em pares ("Não é só X, é Y"), o mesmo convite repetido três vezes, emoji em títulos e um cumprimento de chatbot na home.
4. **Prints da landing velhos e com dado pessoal.** Mostram o seu e-mail, o botão antigo "Tema", a versão do build e uma lista de tarefas vazia. No celular viram um borrão ilegível.
5. **Detalhes de acabamento.** Cards de preço desalinhados, rodapé da barra lateral com espaçamento irregular, "—" usado como ícone de tarefa, `og.png` com fonte padrão do sistema, e-mail pessoal do Gmail como contato.

O que já está bom e não precisa mexer: sem gradientes, sem brilho, sem vidro fosco; movimento contido e respeitando `prefers-reduced-motion`; tokens de cor completos para claro e escuro; ícones de traço único e consistente; prompts da IA em registro neutro; preços claros.

## 1. Travessão (—) e afins

Cerca de 36 ocorrências visíveis para o usuário, em 19 arquivos. Substituição sugerida, caso a caso:

| Onde | Hoje | Depois |
|---|---|---|
| Home (subtítulo) | `Grave, envie um arquivo ou cole um link — a gente transcreve e organiza.` | remover a linha (as abas logo abaixo já dizem isso) |
| Landing, hero | `...por você — e devolve a transcrição...` | ponto ou vírgula: `...por você e devolve...` |
| Landing, nota | `Grátis. Abre no navegador, no celular e no Windows — sem cartão.` | `... e no Windows. Sem cartão.` |
| Landing, features/privacidade/Windows/preços | 6 frases com "—" | reescritas na seção 3 |
| Gravação em andamento (Web e Native) | `Gravando — 00:12`, `Finalizando a gravação — 00:12` | `Gravando · 00:12` (o app já usa "·" em `18 de set. às 22:26 · 28 min`) |
| Gravação concluída | `Gravação concluída — 05:12` | `Gravação concluída · 05:12` |
| Envio de arquivo | `Áudio ou vídeo — MP3, M4A...` | `Áudio ou vídeo: MP3, M4A...` |
| Chat vazio | `Pergunte o que quiser sobre esta conversa — o que ficou decidido, o que fulano disse...` | ver seção 3 |
| Feedback | duas frases com "—" | ver seção 3 |
| Tarefas (ícone) | `<span className="todo-check">—</span>` em `Conversa.jsx:156` e `Todos.jsx:41` | círculo vazio de checkbox (SVG) |
| Faixa de tempo | `00:00 – 04:30` (`shared.js:19`, travessão médio) | `00:00 a 04:30` |
| Dica ao passar o mouse | `${faixa} — ${título}` | `${título} (${faixa})` |
| Aba do navegador | `Dito — gravando` | `Dito · gravando` |
| Pagamento/erros | `Estamos ativando seu plano — isso leva só um instante…`, `Ainda abrindo — o servidor está acordando…`, `Nada foi cobrado — tente de novo.` | ponto final no lugar do travessão |
| Instalação | `É o app de Windows — o único que grava...` | dois-pontos ou ponto |
| `<title>` e meta | `Política de Privacidade — Dito`, `Confirmando seu e-mail — Dito`, meta description | `... | Dito`; description sem travessão |
| Política de privacidade | lista de provedores `<strong>Supabase</strong> — armazenamento...` | dois-pontos |
| Backend | `main.py:1309` e `:1849` (mensagens de erro) | ponto final |
| `STORE-LISTING.md` | título e descrição da Play Store | mesma regra, antes de publicar a ficha |

**O texto que a IA escreve também.** Os prompts de resumo, tópicos, tarefas e chat (`main.py:949`, `:1349`, `:2240`) não proíbem travessão nem emoji, e os modelos usam bastante. Na única conversa que abri não havia nenhum, mas não consigo ler as outras (sem acesso ao banco). Plano: acrescentar uma regra de estilo aos três prompts ("não use travessão nem emoji; separe ideias com vírgula, dois-pontos ou ponto") e só pensar em filtro automático se ainda vazar. Só dá para testar em produção.

## 2. Fontes e tipografia

- **Serifa demais.** `--font-serif` (Source Serif 4) aparece em: título da home, títulos de modais, nomes e preços dos planos, cartões de tópico (`.topic-label`, 15px), títulos de capítulo, título da conversa, `h3` da landing. Mistura de serifa e sans em corpos parecidos é o que dá a sensação de "fonte discrepante".
- **22 tamanhos de fonte.** Inclui 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15 (ao todo 52 declarações com meio pixel). Sem escala, o olho lê como irregularidade.
- **Fontes vêm do Google Fonts.** No app Android e no Windows, sem rede, caem para Georgia/Times. O `og.png` foi gerado com Times (sem o ponto do "Dito.") e a `privacidade.html` inteira está em Georgia.
- **Microrrótulos em caixa alta com espaçamento** (`text-transform: uppercase`, 10 a 11px) em 8 lugares. Na barra lateral ("ONTEM", "FIXADAS") faz sentido; nas etiquetas REGISTRAR / PERGUNTAR / APP PARA WINDOWS da landing é enfeite de template.

Plano:
1. **Serifa só no logotipo e nos títulos grandes da landing** (h1 e h2). Todo o resto do app e os `h3` da landing em Inter. (Alternativa mais simples ainda: Inter em tudo, inclusive na landing. Ver decisões.)
2. **Escala de 7 tamanhos** em variáveis: 12, 13, 14, 16, 20, 28 e 44 (esta última fluida no hero da landing). Trocar as 52 declarações de meio pixel pelo valor inteiro mais próximo.
3. **Hospedar as fontes no próprio app** (pacotes `@fontsource`), o que também tira a chamada externa e resolve o offline.
4. Regerar `og.png` com a fonte certa; passar `privacidade.html` e `confirm.html` para o mesmo Inter.
5. Tirar as etiquetas em caixa alta da landing; manter só nos grupos da barra lateral.

## 3. Texto robotizado

Padrões encontrados:

- **Cumprimento de chatbot**: "O que vamos registrar hoje?" é a fórmula "How can I help you today?". Numa ferramenta de trabalho, o título deve nomear a tarefa.
- **Frases em pares e "não é X, é Y"**: "Não é só um resumo — é uma conversa que dá para interrogar.", "Grave qualquer coisa. Pergunte qualquer coisa.", "Três jeitos de começar. Uma lista só.", "Preço simples.", "Comece hoje.".
- **Repetição**: "Grave, envie um arquivo ou cole um link" aparece na home, na landing e nos textos de instalação.
- **Título que promete e não diz**: "O que você grava sai embaralhado daqui." O mecanismo tem nome, é cifragem.
- **Emoji e exclamação**: "Conta criada! 🎉", "E-mail confirmado! 🎉", "Obrigado! 🙏".
- **Anglicismo e erro**: "Lista de to do's" (plural com apóstrofo não existe em português), "report(s)".
- **Voz misturada**: "a gente lê tudo" e "Fale com a gente" ao lado de "Estamos ativando seu plano". Escolher uma voz: "nós" implícito ("Lemos tudo").
- **Rótulos que mentem**: a aba "Áudio" aceita vídeo (MP4, MOV), e a aba "Vídeo" na verdade é "colar link". Os ícones já dizem a verdade (arquivo, link); os nomes não.
- **Fórmula de chatbot no carregamento**: "Pensando…".

Reescritas propostas (para revisar com o seu ouvido, é a sua voz):

| Onde | Depois |
|---|---|
| Home, título | **Nova conversa** (sem subtítulo) |
| Abas da captura | **Gravar / Arquivo / Link** |
| Landing, hero (subtítulo) | O Dito escuta a reunião, a consulta ou a aula por você e devolve a transcrição e um resumo do que ficou combinado. |
| Landing, seção de produto | h2: **Como o Dito funciona** |
| Feature 1 | h3: **Grave, envie um arquivo ou cole um link.** Texto: Tudo cai na mesma lista de conversas. Fixe as importantes no topo; o resto se organiza por data. |
| Feature 2 | h3: **Tópicos, tarefas e um chat sobre a conversa.** Texto: O Dito separa os tópicos, lista o que ficou combinado e monta um resumo minuto a minuto. Faltou um detalhe? Pergunte. |
| Privacidade | h2: **Suas conversas são cifradas antes de sair do seu aparelho.** Texto: A chave fica só com você e nunca chega ao nosso servidor. Nem nós conseguimos ler o que você guarda no Dito. |
| Windows | h2: **No Windows, grave os dois lados da chamada.** Texto: O navegador só capta o seu microfone. O app para Windows grava você e quem está do outro lado, com uma janela flutuante que fica por cima de tudo durante a conversa. |
| Para quem | h2: **Quem usa o Dito** |
| Preços | h2: **Planos**; nota: Cancele quando quiser, direto no seu plano. O pagamento é processado pelo Stripe e o Dito nunca vê o número do seu cartão. |
| CTA final | h2: **Comece grátis** (e cortar "Grátis. Leva menos de um minuto.", que repete) |
| Chat vazio | Pergunte sobre esta conversa: o que ficou decidido, quem disse o quê, o que faltou. |
| Lista de tarefas | **Tarefas** |
| Contas | "Conta criada.", "E-mail confirmado.", "Mensagem enviada." (sem emoji) |
| Reporte | botão **Sinalizar conteúdo da IA**; "Analisamos todos os relatos." |
| Feedback | Sugestão, problema ou reclamação? Escreva e envie. Lemos tudo. |
| Carregando o chat | **Respondendo…** |

## 4. Visual

Ordem por impacto:

1. **Prints da landing** (`frontend/public/landing/registrar.png` e `perguntar.png`): mostram `pdrbartoli@gmail.com`, o botão antigo "Tema" (hoje é "Configurações"), a versão `v0.1.0 · 075ce4d`, o título quebrado "Start with why- Simon Sinek" e "Nenhuma ação ficou combinada nesta conversa" na lista de tarefas. Refazer com uma conta de demonstração e dados que mostrem o produto cheio. No celular, usar capturas verticais de tela de celular em vez do desktop encolhido.
2. **Tudo em caixa.** Cada seção é um card com borda e raio grande, e dentro há outro card (a captura). Passar as duas features para linhas de duas colunas sem o card externo, e a privacidade e o Windows para texto direto sobre o fundo.
3. **Cards de preço desalinhados** (`lp-plano`): alturas diferentes, botão em posições diferentes, selo "Mais escolhido" cortando a borda. Alinhar com `align-items: stretch` e botão no rodapé do card.
4. **Barra lateral**: "Configurações" em cor cheia e "Enviar feedback" apagado, com 42px e 38px entre os itens (`.nav-feedback` com `margin-top: 4px`). Igualar ritmo e peso.
5. **Ícone de tarefa** é um "—" literal; trocar por um círculo de checkbox.
6. **Menu do celular** é o caractere `☰` (`Layout.jsx:365`), fora da família de ícones SVG.
7. **Janela de navegador falsa** (três pontinhos e a URL) na demonstração animada da landing. Remover a barra, ficar só a moldura.
8. **Tudo centralizado no celular**, inclusive parágrafos de 8 linhas (cartão de privacidade). Alinhar à esquerda o que passa de duas linhas.
9. **Contato**: `pdrbartoli@gmail.com` no rodapé da landing e três vezes na política de privacidade. Trocar por um endereço do domínio do produto (o e-mail de revisão da Play Store usa `dito-app.com`; se o domínio é seu, um `contato@` com encaminhamento resolve).
10. **Três frases de posicionamento diferentes**: "Não anote. Esteja presente." (landing), "Capture, transcreva e organize suas conversas" (login, manifest, `og.png`) e a meta description. Escolher uma e usar em todos.

## 5. Identidade (decisão sua)

Trocar a paleta é a mudança que mais afasta o Dito de "clone do Claude", e a mais barata de executar, porque as cores vivem em variáveis (`:root` e `[data-theme="dark"]`, cerca de 30 linhas). O que exige cuidado é escolher a cor. Direção sugerida: neutros levemente frios no lugar do creme e um acento sóbrio (azul-petróleo, verde-azulado escuro ou azul-tinta), que combina com a promessa de sigilo. Antes de decidir, eu geraria capturas da home e da landing com 2 ou 3 opções para você comparar.

## Plano em três ondas

**Onda 1: texto e tipografia (uma sessão, quase só texto e variáveis).**
Remover todos os travessões e emoji (seção 1), reescrever os textos (seção 3), renomear as abas para Gravar / Arquivo / Link, serifa só em logotipo e títulos grandes, escala de tamanhos, "Tarefas" no lugar de "to do's", ícone de tarefa e menu do celular, regra de estilo nos três prompts da IA, meta description e títulos das páginas.

**Onda 2: acabamento visual da landing e do app.**
Prints novos com conta de demonstração (e capturas verticais para o celular), seções sem caixa dupla, cards de preço alinhados, rodapé da barra lateral, sem etiquetas em caixa alta, sem barra de navegador falsa, alinhamento à esquerda nos parágrafos longos do celular, fontes hospedadas, e-mail de contato do domínio.

**Onda 3: identidade.**
Escolher a paleta (com as capturas comparativas), regerar `og.png`, restilizar `privacidade.html` e `confirm.html`, atualizar `STORE-LISTING.md` e as capturas da Play Store.

Como conferir cada onda: `grep -rnE "—|–" frontend/src frontend/public frontend/index.html` deve voltar só comentários de código; e repetir os scripts de captura (`frontend/e2e-aparencia.mjs` e `e2e-aparencia2.mjs`, criados nesta auditoria) para comparar antes e depois em desktop e celular.

## Decisões que preciso de você

1. **Fonte:** serifa só no logotipo e nos títulos grandes da landing (recomendado), ou Inter em tudo?
2. **Paleta:** manter a atual por enquanto (Ondas 1 e 2 já melhoram muito) ou incluir a troca já?
3. **Voz do texto:** "nós" implícito, sem "a gente" (recomendado), ou manter o tom informal?
4. **E-mail de contato:** você tem um endereço do domínio do Dito para usar?

## O que não consegui verificar

- O tema escuro renderizado (o clique para alternar não funcionou na captura); só revisei as variáveis.
- A aba de chat da conversa aberta e o modal de configurações (mesma causa).
- Se a IA produz travessão nos resumos das outras conversas: não tenho acesso ao banco.
