# Dito na App Store: plano passo a passo

Escrito em 20/09/2026. Linguagem direta, sem termo técnico onde dá pra evitar.

## Resumo em cinco linhas

O app do Dito já existe como aplicativo Android. A mesma base serve pro iPhone,
então não é começar do zero. O que muda é o caminho até a loja: a Apple cobra
uma anuidade, exige um computador Mac pra montar o pacote, exige um botão de
apagar a conta dentro do app e tem regra própria sobre venda de assinatura.
Nada disso é impedimento. São três semanas de trabalho, sendo que boa parte é
espera.

## As três coisas que travam tudo (decidir primeiro)

### 1. Conta de desenvolvedor da Apple

Custa US$ 99 por ano, cobrado no cartão, renovação automática. Dá pra abrir como
pessoa física, com CPF, igual ao que foi feito na Stripe. Nesse caso o app
aparece na loja com seu nome completo. Pra aparecer com o nome de uma empresa,
a Apple pede CNPJ e um cadastro internacional chamado D-U-N-S, que leva de uma
a três semanas. Recomendo abrir como pessoa física agora e trocar pra empresa
depois, se fizer sentido. A troca é possível.

Aprovação da conta: de um dia a uma semana.

### 2. Um Mac pra montar o pacote

A Apple só aceita pacote gerado no programa dela, que só roda em Mac. Não temos
Mac. Três saídas:

| Caminho | Custo | Quando vale |
|---|---|---|
| Serviço de build na nuvem (Codemagic, Bitrise) | grátis até certo limite, depois ~US$ 30/mês | recomendado: o pacote é gerado sozinho a cada envio, igual já acontece hoje no site |
| Alugar um Mac por hora na nuvem | ~US$ 1 a 2 por hora | só se for envio raro |
| Comprar um Mac mini | ~R$ 5.000 | se for virar rotina e você quiser autonomia total |

Recomendo o primeiro. Deixa o envio automático e evita um gasto grande agora.

### 3. Como o iPhone vai cobrar a assinatura

Essa é a regra mais dura da Apple e o motivo número um de app recusado. Se o
app vende assinatura de um serviço digital, a venda tem que acontecer pelo
sistema de compras da Apple, e a Apple fica com 30% no primeiro ano e 15%
depois. A nossa cobrança hoje é pela Stripe, que a Apple não aceita dentro do
app. Também não é permitido colocar um botão dizendo "assine no nosso site".

Duas opções:

**Opção A, mais rápida: primeira versão sem venda no iPhone.** Quem baixa pelo
iPhone usa o plano gratuito. Quem quiser o Avançado assina pelo site, no
navegador, e o app reconhece o plano no login. Dentro do app, no iPhone, a tela
de planos simplesmente não aparece. Isso é permitido e é o que muitos apps de
produtividade fazem. Entramos na loja em semanas, não em meses.

**Opção B: colocar a compra da Apple dentro do app.** Mais trabalho: cadastrar
o produto de assinatura na Apple, ligar isso ao nosso controle de saldo e tratar
renovação e cancelamento. Some a isso a taxa. Duas a três semanas a mais.

Minha recomendação: começar pela A, publicar, e só fazer a B se aparecer gente
de iPhone querendo pagar e travando na hora de assinar.

## O que precisa mudar no app antes de enviar

Isso é tarefa minha, mas você precisa saber o que está sendo feito e aprovar.

1. **Criar a versão iPhone do projeto.** Hoje existe só a Android. A ferramenta
   que usamos gera a de iPhone com um comando, mas depois precisa de ajuste
   manual de ícone, tela de abertura e permissões.
2. **Botão de apagar a conta dentro do app.** A Apple recusa qualquer app que
   deixe criar conta e não deixe apagar. Hoje a exclusão é feita por mim, na
   mão. Precisa virar um botão nas configurações que apaga tudo de verdade.
   Isso serve também pro Android e pro site.
3. **Texto de permissão do microfone.** A Apple exige uma frase explicando por
   que o app quer o microfone, e ela aparece pro usuário. Vai ser algo como
   "O Dito usa o microfone para gravar a conversa que você pediu para
   transcrever".
4. **Ficha de privacidade.** Um arquivo declarando o que o app coleta, mais um
   questionário na loja. Já temos a política de privacidade publicada, o que
   facilita.
5. **Esconder a tela de planos no iPhone** (se ficarmos na opção A).
6. **Compartilhar de outros apps.** No Android o Dito aparece no menu de
   compartilhar do WhatsApp e do YouTube. No iPhone isso é feito de outro jeito
   e dá trabalho. Sugiro deixar de fora da primeira versão e acrescentar depois.
7. **Conferir a atualização automática.** O Dito se atualiza sozinho sem passar
   pela loja. A Apple aceita isso desde que a atualização não mude o que o app
   faz. Nosso uso está dentro da regra, mas vou revisar antes de enviar.

Tempo estimado: uma semana de trabalho, sendo o botão de apagar a conta a parte
mais delicada, porque mexe com dados de verdade.

## O passo a passo, em ordem

**Passo 1. Você abre a conta da Apple.** Em developer.apple.com, com Apple ID,
CPF e cartão. Se você não tiver Apple ID, cria na hora. São uns 20 minutos de
formulário e depois é esperar a aprovação. Me avise quando sair.

**Passo 2. Eu preparo o app** enquanto a conta é aprovada. Os sete itens da
lista acima. As duas coisas correm em paralelo, não precisa esperar uma pra
fazer a outra.

**Passo 3. Ligamos o serviço de build na nuvem.** Você entra com a conta da
Apple, eu configuro o resto. A partir daí o pacote do iPhone é gerado sozinho.

**Passo 4. Primeiro envio, só pra teste.** A Apple tem um programa chamado
TestFlight, que é a versão de teste. O app vai pra lá antes de ir pro público.
Você instala no seu iPhone e usa por alguns dias como se fosse um cliente:
gravar, enviar áudio, colar link, perguntar, apagar a conta. Aqui a gente
descobre o que quebrou.

**Passo 5. Montamos a página da loja.** O texto que já escrevemos pra Play
Store serve quase inteiro. O que falta é foto: a Apple pede capturas de tela em
tamanho de iPhone grande, e eu consigo gerar automaticamente, como já fizemos
pro Android. Também pede classificação etária e o questionário de privacidade.

**Passo 6. Enviamos pra revisão.** Aqui entra um detalhe que derruba muita
gente: a Apple revisa com uma pessoa de verdade, e essa pessoa precisa conseguir
entrar no app. Vamos entregar um usuário e senha de teste com saldo, além de
uma nota explicando que o app transcreve conversas com consentimento de quem é
gravado. App que grava conversa recebe olhar mais atento, então essa nota conta.

**Passo 7. Resposta da Apple.** Costuma vir em um a três dias. Recusa na
primeira tentativa é comum e não é drama: eles dizem qual regra foi quebrada,
a gente corrige e reenvia no mesmo dia. Reserve na cabeça duas idas e voltas.

**Passo 8. No ar.** Depois de aprovado, você escolhe se publica na hora ou em
data marcada.

## Quanto custa e quanto demora

| Item | Custo | Prazo |
|---|---|---|
| Conta Apple Developer | US$ 99/ano | 1 a 7 dias de aprovação |
| Build na nuvem | grátis no começo | 1 dia pra configurar |
| Preparar o app | meu tempo | ~1 semana |
| Teste no seu iPhone | zero | 2 a 4 dias |
| Revisão da Apple | zero | 1 a 3 dias por tentativa |

Do "sim" até estar na loja: **três a quatro semanas**, contando uma recusa no
meio do caminho.

## O que eu preciso de você

1. Decidir: assinatura fora do app no iPhone (opção A) ou compra da Apple desde
   o começo (opção B).
2. Decidir: conta da Apple como pessoa física ou empresa.
3. Abrir a conta e pagar os US$ 99.
4. Ter um iPhone à mão pra testar antes de publicar. Se não tiver, dá pra
   contornar, mas fica bem pior.

O resto é comigo.

## Riscos conhecidos

- **Recusa pela regra de pagamento.** É o risco principal. A opção A reduz
  bastante, desde que não sobre nenhum link pra assinar no site dentro do app.
- **Recusa por app que grava conversa.** Mitigado com aviso claro dentro do app
  sobre consentimento de quem é gravado, que já está no texto da loja.
- **Recusa por falta de exclusão de conta.** Some assim que o botão existir.
- **Perder a chave de assinatura.** No iPhone isso é menos grave que no Android,
  porque a Apple guarda uma cópia, mas ainda assim vamos anotar tudo num lugar
  seguro.
