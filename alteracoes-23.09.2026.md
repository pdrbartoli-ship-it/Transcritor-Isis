# Alterações 23.09.2026

## 1. Janelinha de gravação (app de Windows): posição

### O que foi alterado
- A janelinha de gravação passou a nascer no **centro da parte de baixo da tela**, e não mais no canto inferior direito, onde ficava em cima da imagem da câmera do Teams.
- A janelinha agora **lembra onde foi deixada**. Toda vez que é arrastada, a posição fica guardada, e ela reaparece ali ao minimizar o Dito de novo (antes voltava sempre ao canto).
- Se a posição guardada ficou fora da tela (por exemplo, estava num segundo monitor que foi desligado), ela volta para o centro.
- Arquivos: `frontend/src/lib/miniRecorder.js`, `frontend/src/pages/Mini.jsx`, comentário em `frontend/src/lib/avisoWindow.js`.
- Teste novo: `frontend/e2e-mini-posicao.mjs`.
- É mudança só de site: chega ao app de Windows na próxima abertura, sem instalador novo nem permissão nova.

### Resultado
Sucedido.
- `e2e-mini-posicao.mjs`: 5 de 5 casos ok (nasce no centro; arrastar guarda a posição, inclusive com escala de tela 150%; renasce onde foi deixada; vale num segundo monitor ligado; volta ao centro se o monitor foi desligado).
- `e2e-gravacao-navegacao.mjs` (regressão da gravação): ok.
- Build de produção: ok.

### O que faltou
- O teste simula o Windows no navegador. A conferência final, arrastando a janelinha de verdade durante uma chamada no Teams, só dá para fazer no próprio Windows.
- A janelinha do navegador (picture-in-picture do Chrome/Edge) não mudou: ali quem decide a posição é o navegador, e o site não consegue escolher.

## 2. Tela Perguntar: "Nova pergunta" e "Sinalizar conteúdo da IA"

### O que foi alterado
- Saiu o botão **"Nova pergunta"**. Para começar outra pergunta, basta clicar de novo em **Perguntar** na barra lateral (no celular, pelo menu): a tela volta ao início, com a barra no meio. O "voltar" do navegador continua levando à página anterior de verdade, sem passos repetidos.
- **"Sinalizar conteúdo da IA"** saiu do topo da tela. Virou uma bandeira pequena e quase transparente embaixo de cada resposta, à direita da linha "Procurei em N conversas…". Ganha cor ao passar o mouse e mostra o texto "Sinalizar conteúdo da IA"; o clique abre o mesmo formulário de antes. Na tela inicial, sem resposta, ela não aparece.
- Conserto encontrado no teste: no celular o texto do Perguntar encostava na borda da tela (defeito anterior). A página ganhou margem lateral.
- Arquivos: `frontend/src/pages/Perguntar.jsx`, `frontend/src/components/Layout.jsx`, `frontend/src/index.css`; ajuste de uma verificação em `frontend/e2e-perguntar.mjs`.
- Teste novo: `frontend/e2e-perguntar-rodape.mjs` (não gasta pergunta do saldo: abre uma pergunta já feita).

### Resultado
Sucedido.
- `e2e-perguntar-rodape.mjs`: 9 de 9 verificações ok no computador (1280px) e no celular (380px), contra o servidor local: sem "Nova pergunta", sem bandeira no topo, uma bandeira por resposta, bandeira discreta, abre o modal, clicar em Perguntar volta à tela inicial, sem entrada nova no histórico, sem erro de página.
- Capturas de tela conferidas nos dois tamanhos.
- Em produção (commit d3a592c, após o deploy): mesmo teste, 9 de 9 ok.

### O que faltou
- As telas de cada conversa (visão geral, tarefas, chat etc.) continuam com o botão "Sinalizar conteúdo da IA" grande no topo (`ConversaHeader.jsx`). Não foi mexido porque o pedido era sobre o Perguntar.

## 3. Tela Perguntar: perguntas anteriores na hora e busca preparada em segundo plano

### O que foi alterado
- As **perguntas anteriores** aparecem quase na hora. A última lista fica guardada no aparelho, cifrada com a chave do usuário, e é mostrada antes de o banco responder; quando ele responde, a lista é atualizada. Ao sair da conta ela fica ilegível junto com o resto.
- O aviso **"Preparando a busca (x de y)" saiu da tela inicial**. A preparação continua acontecendo em segundo plano. Os avisos de falha ("Não consegui preparar a busca neste aparelho" e "Busca por palavra por enquanto") continuam aparecendo.
- Uma **pergunta nova espera a busca ficar pronta** antes de responder, para sair sempre com a busca completa. Durante a espera, a resposta mostra "Preparando a busca (x de y)". Se passar de 60 segundos, responde com o que já houver. Abrir uma pergunta anterior não espera nada.
- Arquivo: `frontend/src/pages/Perguntar.jsx`. Teste novo: `frontend/e2e-perguntar-espera.mjs` (gasta 1 pergunta do saldo).
- Commit `7407c25`, publicado. É mudança só de site: vale para o site, o Android (atualização automática, versão 1.0.176) e o app de Windows (abre o site), sem instalador novo.

### Resultado
Sucedido.
- `e2e-perguntar-espera.mjs`, no servidor local: 10 de 10 verificações ok. Pergunta feita com a busca ainda sendo preparada esperou (de "1 de 17" a "17 de 17") e respondeu com 172 de 172 trechos prontos, citando as fontes certas. A lista guardada está cifrada. A tela inicial não mostrou o aviso em momento nenhum.
- Em produção, depois do deploy: lista apareceu em 0,98 s na primeira visita e em 0,23 s ao voltar à tela; nenhum aviso de preparação na tela inicial; sem erro de página. O site e o pacote do Android foram conferidos com o código novo.

### O que faltou
- Não foi testado no celular nem no app de Windows de verdade, só no navegador. Como é mudança só de site, deve chegar igual na próxima abertura.
- Num acervo bem maior, a primeira pergunta pode passar dos 60 segundos de espera. Nesse caso ela responde com a busca por palavra, que acerta menos.
- Num aparelho novo, a primeira visita ainda espera o banco para mostrar a lista, porque não há nada guardado.

## 4. Aviso de reunião (app de Windows): janela em branco presa na tela

### O que foi alterado
- **Causa encontrada:** a janelinha "Reunião no Google Meet, quer gravar?" nasce vazia e pede o texto à janela principal. O pedido saía antes de ela estar pronta para ouvir a resposta; quando a resposta chegava primeiro (o caso de entrar e sair rápido de uma chamada), a janela ficava em branco para sempre. Em branco ela não tinha botão nem o prazo de 30 s que a faz sumir sozinha, e por isso não havia como tirá-la.
- A janelinha agora só pede o texto **depois** de estar pronta para recebê-lo.
- Se o texto não chegar, ela pede de novo algumas vezes e, sem resposta, **fecha sozinha** em cerca de 7 s.
- Ganhou um **×** discreto no canto, que sempre fecha a janela, mesmo se a janela principal não responder.
- **Sair da chamada antes de responder fecha o convite.** O aviso de "a reunião acabou" já vinha do detector, mas ninguém o ouvia.
- Duas detecções quase juntas (sair e voltar à chamada) não disputam mais a mesma janela: só uma pergunta aparece.
- Arquivos: `frontend/src/pages/Aviso.jsx`, `frontend/src/components/reuniao/useDeteccaoReuniao.js`, `frontend/src/lib/avisoWindow.js`, `frontend/src/index.css`; só comentário em `frontend/src-tauri/src/meeting/mod.rs`.
- Teste novo: `frontend/e2e-aviso-travado.mjs`. Casos novos em `frontend/e2e-deteccao-reuniao.mjs`.
- É mudança só de site: chega ao app de Windows na próxima abertura, sem instalador novo nem permissão nova.

### Resultado
Sucedido nos testes.
- `e2e-aviso-travado.mjs` (a janelinha com o Windows simulado): 4 de 4 ok. Com a resposta chegando antes da hora, o texto aparece; com a principal muda, fecha sozinha em 7,5 s; o × fecha nos dois casos. O mesmo teste contra o código antigo **reproduz o defeito** (janela fica em branco).
- `e2e-deteccao-reuniao.mjs`: todos os casos antigos e os 3 novos ok (duas detecções juntas geram um aviso só; fim da reunião fecha o convite; o fim de outra reunião não fecha o convite errado).
- Build de produção: ok.
- Em produção, depois do deploy (commit `61be60a`): o mesmo `e2e-aviso-travado.mjs` rodado contra o site publicado, 4 de 4 ok.

### O que faltou
- A reprodução exata (entrar e sair de uma chamada do Meet no Windows) só dá para fazer no próprio Windows. A causa foi deduzida pelo código e confirmada na simulação, não na máquina onde aconteceu.
- A janela que já está presa agora some ao fechar e reabrir o Dito (ou pela bandeja: Sair).
