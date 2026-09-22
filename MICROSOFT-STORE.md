# Dito na Microsoft Store: o que apertar

Roteiro para testar num PC com Windows e enviar o pacote no Partner Center.
Escrito em 22/09/2026.

O produto já está no ar na Store (`Dito.`, id **9PDVG213Q755**,
<https://apps.microsoft.com/detail/9pdvg213q755>) e a landing já manda para lá
todo mundo que abre o site num PC. O que falta é enviar uma versão nova do
pacote, com duas coisas que a publicada não tem: o detector de reunião e o
"iniciar com o Windows" funcionando de dentro do pacote.

**Versão a enviar: 1.0.98.0**, que é o build do commit `b75d404`, já publicado
na release. Se um build novo rodar antes do envio, o número sobe junto: confira
o que está escrito na release antes de subir o arquivo.

## Antes de enviar: 20 minutos num PC de verdade

Isto é teste, não formalidade. Duas coisas do pacote não dá para provar no CI
nem no Codespace, e as duas são o recurso inteiro.

**1. Instalar a cópia de teste.** Na release
[desktop-store](https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/tag/desktop-store)
baixe `Dito-teste.cer` e `Dito-teste.msix`.

- Abra o `.cer`, clique em **Instalar Certificado**, escolha **Computador
  Local**, depois **Colocar todos os certificados no repositório a seguir** e
  **Pessoas Confiáveis**. Sem isso o `.msix` recusa a instalar.
- Abra o `Dito-teste.msix` e clique em **Instalar**.
- Se você já tinha o Dito instalado pelo `.exe`, desinstale antes. Dois Ditos ao
  mesmo tempo deixam dois detectores rodando, e o teste fica sem sentido.

**2. Ligar o recurso.** Abra o Dito, entre com seu e-mail e vá em
**Configurações**. Ligue **avisar quando começar uma reunião**. O interruptor
liga três coisas de uma vez: o detector, o ícone na bandeja e o início com o
Windows.

**3. Testar a reunião.** Entre numa reunião do Zoom, Teams ou Google Meet. Pode
ser uma sala sua, sozinho, desde que o microfone abra de verdade. Em uns 10
segundos o convite do Dito tem de aparecer.

- Apareceu: o recurso funciona dentro do pacote.
- Não apareceu: instale o `Dito-setup.exe` da release `desktop-latest` e repita.
  Se no `.exe` aparecer e no `.msix` não, me avise com essas palavras, "funciona
  no exe, não no msix". Quer dizer que o pacote está bloqueando a leitura do
  registro, e o conserto já está desenhado: ler as sessões de áudio do WASAPI em
  vez do registro, sem mexer na regra de quando avisar.

**4. Reiniciar o computador.** É o teste que só existe por causa desta versão:
até agora, na versão da Store o Dito não voltava sozinho. Com o recurso ligado,
reinicie e espere um minuto na área de trabalho. O ícone do Dito tem de aparecer
na bandeja, perto do relógio, sem a janela abrir na sua frente.

- Se não aparecer, abra o **Gerenciador de Tarefas**, aba **Aplicativos de
  inicialização**, e veja se o Dito está lá como *Desativado*. Se estiver, ligue
  ali e reinicie de novo. Quando alguém desliga um app por essa tela, o Windows
  passa a recusar todo pedido do próprio app, e nenhuma linha de código passa por
  cima disso.

**5. Só depois disso, enviar.** No Partner Center, em **Update your product**,
suba o `Dito-store.msix`, que é o outro arquivo da mesma release, o sem
assinatura (quem assina é a Microsoft). Confirme que a versão listada é a
**1.0.98.0** e envie.

## O que mudou nesta versão

- **Iniciar com o Windows dentro do pacote.** Um MSIX ignora a chave `Run` do
  registro, que é como o Dito fazia isso no instalador comum. Agora o manifesto
  declara um `windows.startupTask` e o app o liga sozinho, pelo WinRT, quando
  percebe que está empacotado. Fora do pacote nada mudou. Se o Windows recusar,
  o modo bandeja continua de pé: o que se perde é voltar sozinho, não o recurso.
- **A landing manda para a Store.** "Instalar grátis" num PC agora abre a página
  da Store em vez de baixar o `.exe`. Some o passo que mais fazia gente desistir,
  a tela azul "O Windows protegeu seu PC". O instalador direto continua na
  página, em letra miúda, para quem usa um computador com a Store bloqueada.

## O que continua fora do alcance daqui

O envio no Partner Center é seu, não há como automatizar nem testar isso do
Codespace. O teste de reunião também: a máquina do CI não tem dispositivo de
áudio nem Zoom instalado. Por isso os passos 3 e 4 são a única prova que existe
de que o recurso funciona empacotado.
