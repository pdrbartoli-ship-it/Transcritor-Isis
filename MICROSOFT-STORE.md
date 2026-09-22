# Dito na Microsoft Store: o que apertar

Roteiro para testar num PC com Windows e enviar o pacote no Partner Center.
Atualizado em 22/09/2026, depois da primeira rodada de testes.

O produto já está no ar na Store (`Dito.`, id **9PDVG213Q755**,
<https://apps.microsoft.com/detail/9pdvg213q755>) e a landing já manda para lá
todo mundo que abre o site num PC. O que falta é enviar a versão nova do pacote.

**Versão a enviar: 1.0.99.0**, que é o build do commit `a860cf6`, já publicado
na release. Se um build novo rodar antes do envio, o número sobe junto: confira
o que está escrito na release antes de subir o arquivo.

## O que mudou desde o pacote que você testou

- **A gravação não funcionava dentro do pacote.** O microfone de um app da Store
  só abre depois de o app pedir a permissão, e o Dito nunca pedia: o Windows
  recusava, o erro não aparecia em lugar nenhum e a gravação saía muda. Agora
  pede, e se a resposta for não, a tela diz onde clicar para liberar.
- **Silêncio não vira mais transcrição.** Era de onde saía a reunião escrita
  como "Thank you. Thank you.": o Whisper inventa frases quando o áudio é mudo.
  Se não entrar som, o Dito avisa em vez de transcrever.
- **O ícone estava na cor antiga.** Os ícones do pacote eram os terracota de
  antes da identidade verde. Refeitos.
- **"Avisar quando começar uma reunião" nasce ligado.** Ele só pergunta, nunca
  grava sozinho.
- **O convite que aparece por cima da reunião foi redesenhado**, com o selo do
  microfone, o ponto de gravação no botão e o fio que mostra que a pergunta
  some em 30 segundos.
- **Link do YouTube voltava traduzido.** Um vídeo em inglês voltou transcrito em
  alemão no teste de hoje. Agora a legenda pedida é sempre a da língua falada no
  vídeo, e legenda pela metade manda o Dito ouvir o áudio de verdade. Isto já
  está no ar, não depende do pacote novo.

## Antes de enviar: 20 minutos num PC de verdade

**1. Instalar a cópia de teste.** Na release
[desktop-store](https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/tag/desktop-store)
baixe `Dito-teste.cer` e `Dito-teste.msix`.

- Desinstale primeiro o Dito que você instalou no teste passado (Configurações
  do Windows, Aplicativos, Dito, Desinstalar). Dois Ditos ao mesmo tempo deixam
  dois detectores rodando.
- O certificado você já instalou da outra vez; se pedir de novo, é o mesmo
  caminho: Instalar Certificado, Computador Local, Pessoas Confiáveis.
- Abra o `Dito-teste.msix` e clique em **Instalar**.

**2. Olhar o ícone.** No menu Iniciar, o ícone do Dito tem de estar no verde
escuro da marca, não no laranja antigo.

**3. Gravar.** Este é o teste principal, o que falhou da última vez. Abra o
Dito, entre com seu e-mail e grave meio minuto falando.

- As barrinhas têm de se mexer enquanto você fala, e a gravação tem de terminar
  com o áudio pronto para transcrever.
- Se o Windows pedir permissão de microfone, aceite.
- Se aparecer uma mensagem dizendo que o Windows está bloqueando o microfone,
  siga o que ela manda (Configurações, Privacidade e segurança, Microfone) e
  grave de novo.
- Se continuar sem funcionar e sem mensagem nenhuma, me mande o arquivo de log:
  tecle Windows+R, cole `%LOCALAPPDATA%\com.dito.app\logs` e envie o arquivo de
  hoje. Ele passou a existir exatamente para isto.

**4. Testar a reunião.** Entre numa reunião do Zoom, Teams ou Google Meet (pode
ser uma sala sua, sozinho, desde que o microfone abra). Em uns 10 segundos o
convite do Dito tem de aparecer, já com a cara nova. A opção vem ligada de
fábrica agora, não precisa ligar nada.

- Não apareceu: instale o `Dito-setup.exe` da release `desktop-latest` e repita.
  Se no `.exe` aparecer e no `.msix` não, me avise com essas palavras, "funciona
  no exe, não no msix". Quer dizer que o pacote está bloqueando a leitura do
  registro, e o conserto já está desenhado: ler as sessões de áudio do WASAPI em
  vez do registro.

**5. Reiniciar o computador.** Com o recurso ligado, reinicie e espere um minuto
na área de trabalho. O ícone do Dito tem de aparecer na bandeja, perto do
relógio, sem a janela abrir na sua frente.

- Se não aparecer, abra o **Gerenciador de Tarefas**, aba **Aplicativos de
  inicialização**, e veja se o Dito está lá como *Desativado*. Se estiver, ligue
  ali e reinicie de novo. Quando alguém desliga um app por essa tela, o Windows
  passa a recusar todo pedido do próprio app, e nenhuma linha de código passa por
  cima disso.

**6. Só depois disso, enviar.** No Partner Center, em **Update your product**,
suba o `Dito-store.msix`, que é o outro arquivo da mesma release, o sem
assinatura (quem assina é a Microsoft). Confirme que a versão listada é a
**1.0.99.0** e envie.

## O que continua fora do alcance daqui

O envio no Partner Center é seu, não há como automatizar nem testar isso do
Codespace. O teste de gravação e o de reunião também: a máquina do CI não tem
dispositivo de áudio nem Zoom instalado. Por isso os passos 3, 4 e 5 são a única
prova que existe de que o recurso funciona empacotado.
