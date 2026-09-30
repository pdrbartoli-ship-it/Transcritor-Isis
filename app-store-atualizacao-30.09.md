# Atualização do Dito Mobile · 30/09/2026

Plano para resolver a segunda recusa da Apple (envio `c6530cf6`, revisado em
30/09/2026, versão 1.0 build 5) e publicar o Dito na App Store, colocando a
compra dentro do app sem perder margem.

Li o código da `main` local (commit `283aec7`). Cada item diz se vale também
para o computador. O que ficou para depois está em [wishlist.md](wishlist.md).

---

## Estado da obra (30/09/2026)

As fases de código estão feitas, com o RevenueCat como caminho de compra. O que
falta não é código:

| Fase | Estado |
|---|---|
| 0 · Cadastros na Apple | **Você.** Nada começado. É o caminho crítico. |
| 1 · Banco e servidor | Feito. O SQL precisa ser **rodado por você** no SQL Editor. |
| 2 · App de iPhone | Feito. Falta colar as **chaves públicas do RevenueCat** em `compraLoja.js`. |
| 3 · Site | Feito. |
| 4 · Reenvio | As notas do revisor estão em [APPSTORE-LISTING.md](APPSTORE-LISTING.md). O resto é você. |
| 5 · Android | Não começado, de propósito — fica para a rodada seguinte. |

O que foi conferido daqui: 51 verificações do servidor (webhook das duas lojas,
`GET /planos` por plataforma, o 409, o `/conta/apagar`) e a suíte
`testes-e2e/08-assinatura.mjs` no navegador. A compra de verdade só no aparelho,
com um Apple ID de Sandbox, depois da Fase 0.

Duas coisas que o plano não previa e apareceram na implementação:

- **A ordem entre o deploy e o SQL.** O push na main publica o app e o servidor
  sozinhos; o SQL é rodado à mão. Nessa janela o código novo fala com o banco
  antigo, e o Postgres recusa a consulta inteira quando uma coluna pedida não
  existe — o 409 deixaria de barrar cobrança dupla e apagar a conta deixaria de
  cancelar no Stripe. Os dois lados agora tentam de novo sem as colunas novas,
  então a ordem deixou de importar.
- **Troca de plano na loja.** Dentro de um mesmo grupo de assinaturas, comprar o
  outro plano *é* a troca: a Apple substitui a assinatura e faz a proporção do
  que já foi pago. Então no celular os botões continuam vivos para quem já
  assina pela loja, ao contrário do site, onde a troca é só pelo Portal.

---

## O que a Apple recusou, e por quê

A decisão de 22/09 foi a **opção A**: o app de iPhone não vende, quem quer
plano pago assina no site. Isso está implementado em
[platform.js:31](frontend/src/lib/platform.js#L31), na função `podeVender()`,
que some com "Meu plano", com o modal de planos e com todo botão "Ver planos"
no iOS.

Não bastou. O texto da recusa:

> The app accesses digital content purchased outside the app, such as
> subscription plans, but that content isn't available to purchase using
> In-App Purchase.

O problema não é a conta valer em vários aparelhos. A regra 3.1.3(b), serviços
multiplataforma, permite isso de propósito, com uma condição: os mesmos planos
precisam **também** poder ser comprados por dentro do app. O revisor entrou com
uma conta que tinha plano pago, viu os recursos pagos funcionando, e não achou
onde comprar.

O comentário que está no `podeVender()` já previa este dia: "é aqui que a
compra da Apple será ligada no dia em que existir". Chegou.

### Por que não dá para fugir da comissão

Desde junho de 2026, por acordo com o CADE, a loja brasileira aceita pagamento
alternativo. Mas a própria Apple exige que o botão de compra dela apareça em
toda tela onde há oferta de plano, com destaque igual ou maior. O link externo
convive com a compra da Apple, não substitui.

Taxas na loja do Brasil:

| Caminho | Padrão | Com o Small Business Program |
|---|---|---|
| Compra da Apple | 21% + 5% = 26% | 10% + 5% = **15%** |
| Link clicável para o site | 15% | 10% |
| Texto sem link | 0% | 0% |

Entrar no Small Business Program é o que separa 26% de 15%. É formulário, e o
Dito se qualifica com folga (o limite é faturar menos de US$ 1 milhão por ano).

**A saída é repassar a comissão no preço do iPhone**, que a Apple permite: não
existe nenhuma exigência de preço igual entre o app e o site.

### O computador não tem esse problema

A política 10.8.1 da Microsoft Store deixa app que não é jogo usar o próprio
sistema de cobrança, sem comissão nenhuma. O Dito no Windows continua como
está, cobrando pela Stripe. Nada neste plano muda isso.

---

## Os preços

| | Site, Windows e Android (hoje) | iPhone (novo) |
|---|---|---|
| **Iniciante** | R$ 18/mês no anual (R$ 216/ano), R$ 20 avulso | R$ 24,99/mês no anual (R$ 299,90/ano), R$ 27,90 avulso |
| **Avançado** | R$ 36/mês no anual (R$ 432/ano), R$ 40 avulso | R$ 49,99/mês no anual (R$ 599,90/ano), R$ 54,90 avulso |

Critério dos valores: cobrem a comissão mais o imposto sem comer a margem,
mantêm os mesmos 10% de desconto do anual que o site já pratica, e caem em
números que parecem preço, não resultado de conta.

**Os valores acima são proposta, não decisão.** A Apple recolhe ISS, PIS e
COFINS antes de calcular a comissão, e o líquido real aparece na tabela de
preços do App Store Connect, na hora de cadastrar cada produto. O número de lá
é o que vale. Se o líquido do Iniciante ficar abaixo do que a Stripe deixa
hoje, sobe para o próximo degrau (R$ 29,90).

### Quem já paga não é tocado

Quem assina R$ 20 pela Stripe e instala o app de iPhone continua pagando R$ 20.
O preço maior vale só para quem assinar pela primeira vez por dentro do iPhone.

---

## Fase 0 · Cadastros na Apple

**Você.** É o caminho crítico: enquanto isso não estiver pronto, o código não
tem o que testar. Não vale para o computador.

1. Contracts, Tax, and Banking: aceitar o Paid Applications Agreement e
   preencher dados bancários e fiscais. É o passo mais demorado, uns dias.
2. Pedir entrada no Small Business Program.
3. Cadastrar o grupo de assinaturas com os quatro produtos, com os
   identificadores abaixo (eu preciso deles exatos no código):

   | Produto | Identificador |
   |---|---|
   | Iniciante mensal | `br.com.albiecloud.dito.iniciante.mensal` |
   | Iniciante anual | `br.com.albiecloud.dito.iniciante.anual` |
   | Avançado mensal | `br.com.albiecloud.dito.avancado.mensal` |
   | Avançado anual | `br.com.albiecloud.dito.avancado.anual` |

4. Confirmar que o contrato de desenvolvedor atualizado, com os termos do
   Brasil, já foi aceito (era obrigatório até 6 de julho de 2026).

---

## Fase 1 · Banco e servidor

Vale para o computador: sim, indiretamente. A tabela é a mesma para todo mundo,
e o app de Windows lê o plano dela. Nada muda no comportamento dele.

### 1.1 Tabela `subscriptions`

Hoje ela só sabe falar Stripe
([supabase/subscriptions.sql](supabase/subscriptions.sql)): `stripe_customer_id`,
`stripe_subscription_id`. Precisa saber de onde veio cada assinatura, porque
quem assinou pela Apple não pode ser mandado para o portal da Stripe, nem
cancelado por lá quando apagar a conta.

Colunas novas: `origem` (`stripe` | `apple` | `google`, com `stripe` como
padrão para não mexer em quem já existe) e `loja_assinatura_id`, que guarda o
identificador original da compra na loja.

Sai num arquivo `supabase/assinatura_loja.sql`, para você rodar no SQL Editor.
Eu não tenho service role aqui.

### 1.2 Webhook novo

A Apple avisa mudanças de assinatura pelas App Store Server Notifications V2, e
o Google pelas Real-time Developer Notifications. Um endpoint novo no
[backend/main.py](backend/main.py), irmão do `/billing/webhook` que já existe,
recebendo os dois e gravando na mesma tabela pela mesma função
`_gravar_assinatura`.

A amarração entre a compra e a conta é feita mandando o id do usuário junto da
compra, no campo que as duas lojas reservam para isso. Sem ele não há como
saber de quem é a assinatura que a loja avisou.

### 1.3 Três ajustes no que já existe

- **`POST /conta/apagar`** cancela a assinatura no Stripe antes de apagar.
  Assinatura de loja não dá para cancelar pelo servidor. Passa a apagar a conta
  e avisar na tela que o cancelamento precisa ser feito nos ajustes do aparelho.
- **O 409 de assinatura repetida** em `/billing/create-checkout-session` hoje
  só olha para o Stripe. Passa a barrar também quem já assina por uma loja.
- **`GET /planos`** passa a aceitar a plataforma e devolver a régua certa. O
  site, o Windows e o Android continuam recebendo o que recebem hoje.

---

## Fase 2 · App de iPhone

Não vale para o computador.

### 2.1 A compra

Proposta: **RevenueCat** (`@revenuecat/purchases-capacitor`), em vez de eu
escrever um plugin Swift de StoreKit e outro Kotlin de Play Billing.

Por quê: resolve as duas lojas com um plugin só, manda um webhook só para o
servidor, e cuida da parte chata (recibo, renovação, período de carência,
reembolso, troca de plano). É grátis até uns R$ 13 mil por mês de assinatura
rastreada, e 1% depois disso. Como o Android vem logo atrás, o mesmo trabalho
serve duas vezes.

O que ele vê: plano, valor e id da compra. Não vê conversa nem áudio, que
continuam cifrados no aparelho.

Se você preferir não acrescentar essa dependência, dá para escrever os plugins
nativos à mão. Fica umas duas semanas mais longo e a manutenção passa a ser
nossa. Recomendo o RevenueCat agora e a troca depois, se um dia o 1% incomodar.

### 2.2 As telas

- `podeVender()` volta a valer no iOS, e o `PlanModal` no iPhone usa a compra
  da Apple no lugar do checkout do Stripe.
- **O preço exibido vem da Apple**, perguntado na hora de desenhar a tela, e
  não escrito no código. Assim o número mostrado é sempre o que vai ser
  cobrado, mesmo se a Apple mexer em imposto ou câmbio depois. A estrutura da
  tela não muda: o anual dividido por mês em destaque, "com cobrança anual" e o
  avulso nas duas linhas pequenas de baixo.
- **"Restaurar compras"**, que a Apple exige, para quem trocou de aparelho.
- **Frase de renovação automática e links de termos e privacidade**, visíveis
  na mesma tela dos planos. Tela de assinatura sem isso é recusa na revisão,
  independentemente do resto.
- **"Trocar de plano ou cancelar"** passa a olhar a `origem`: quem veio do site
  vai para o portal da Stripe como hoje, quem veio da Apple vai para a tela de
  assinaturas do iPhone, único lugar onde ela pode ser cancelada.

---

## Fase 3 · Site

Vale para o computador: a landing é a mesma, então a nota nova aparece lá
também. É o comportamento certo, porque quem usa o Windows assina pelo site.

Uma linha na tabela de preços da
[Landing.jsx](frontend/src/pages/Landing.jsx#L445), no lugar e no tamanho da
nota que já existe ali:

> Estes são os preços para quem assina pelo site. Pelo aplicativo do iPhone a
> assinatura sai mais cara, porque a Apple cobra uma taxa sobre cada cobrança.

Não é exigência da Apple, é proteção contra o chamado de quem assinou pelo
iPhone e depois viu R$ 20 no site. E, por estar fora do app, é permitida sem
pedir nada a ninguém.

---

## Fase 4 · Reenvio

**Eu:** notas para o revisor explicando que a conta é a mesma em todos os
aparelhos, que os quatro planos estão disponíveis por compra dentro do app, e
que o acesso ao que foi comprado fora está amparado pela 3.1.3(b). Mais a conta
de teste com saldo e o aviso sobre consentimento de quem é gravado.

**Você:** responder a mensagem no App Store Connect dizendo que a compra dentro
do app foi implementada, e disparar a build no Codemagic.

Não vale discutir a 3.1.3(b) com o revisor antes de o código existir. A leitura
deles sobre a palavra "também" é firme e já custou dois envios.

---

## Fase 5 · Android, logo em seguida

Não vale para o computador.

O `podeVender()` devolve verdadeiro no Android, então o app da Play Store hoje
abre o checkout do Stripe no navegador. O Google proíbe a mesma coisa que a
Apple, e isso é motivo de remoção do app. Como o RevenueCat e o webhook da Fase
1 já atendem as duas lojas, o que falta no Android é cadastrar os produtos no
Play Console e ajustar a tela. Fase curta, e evita repetir a história.

Preços do Android saem junto, na mesma faixa do iPhone, porque a taxa é a mesma.

---

## Testes

O que dá para testar daqui: o webhook novo (com os eventos de exemplo das duas
lojas), o `GET /planos` por plataforma, o 409 de assinatura repetida, a nota da
landing e o `/conta/apagar` com assinatura de loja.

O que só dá para testar no aparelho, e precisa de você: a compra de ponta a
ponta com um Apple ID de Sandbox, no seu iPhone. Comprar, ver o plano chegar na
conta, fechar e abrir o app, restaurar a compra, cancelar pelos ajustes e
confirmar que o plano cai para grátis. Sandbox não cobra de verdade.

---

## Fica para depois

Vai para a [wishlist.md](wishlist.md):

- **A frase no app sobre o site ser mais barato.** Possível no Brasil desde
  junho e sem taxa, mas exige a StoreKit External Purchases or Offers
  Entitlement com a região `br`. Não vale segurar o lançamento por isso.
- **Link clicável para o site a 10%.** Economiza 5 pontos e exige o
  entitlement, a folha de divulgação desenhada pela Apple, um processador com
  PCI nível 1 aprovado na revisão, e relatório mensal para a Apple pela
  External Purchase Server API. Muito trâmite por 5 pontos, e o botão da Apple
  teria que continuar ali do lado. Revisitar quando o volume do iPhone
  justificar.
