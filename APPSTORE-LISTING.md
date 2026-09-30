# Dito: textos da página da App Store

Pronto para colar no App Store Connect, versão 1.0. Cada bloco diz em que
campo vai.

Três cuidados que valem para a Apple e não valiam para a Play Store:

- **Nada de plano pago nem de preço.** O app de iPhone não vende (opção A), e a
  Apple recusa página que aponta para compra fora do app.
- **Nada de "Android"** nem de outra plataforma de celular.
- As capturas mostram uma reunião de demonstração, criada na conta de revisão.

---

## Distribuição → versão 1.0

### Capturas de tela, iPhone de 6,5 polegadas (1242 × 2688)

Os arquivos estão em `~/dito-loja-ios/`, fora do repositório. Arraste nesta ordem:

1. `01-inicio.png`: a tela de gravar
2. `02-reuniao.png`: a reunião com os tópicos
3. `03-reuniao-tarefas.png`: as tarefas e o resumo minuto a minuto
4. `05-pergunta.png`: uma pergunta sobre a reunião
5. `04-minuto-a-minuto.png`: o trecho com a transcrição
6. `06-conversas.png`: a lista de conversas

Para gerar de novo: `npm run dev` e depois `node e2e-capturas-ios.mjs`, na
pasta `frontend`.

### Texto promocional (máx. 170)

```
Grave a reunião, a consulta ou a aula e receba a transcrição e um resumo do que ficou combinado. Tudo cifrado no seu aparelho.
```

### Descrição (máx. 4000)

```
O Dito transforma reuniões, consultas e aulas em texto organizado. Foi feito para quem vive de escutar: médicos, psicólogos, advogados e outros profissionais.

Grave na hora, envie um arquivo de áudio ou vídeo, ou cole um link. O Dito devolve a transcrição e um resumo do que ficou combinado, em minutos.

PARA QUE SERVE
• Consultas e sessões: registre o atendimento sem digitar durante a conversa.
• Reuniões: tópicos, tarefas com responsável e um resumo minuto a minuto.
• Aulas e entrevistas: horas de gravação viram minutos de leitura.

COMO FUNCIONA
1. Grave, envie um arquivo ou cole um link.
2. O Dito transcreve e resume.
3. Pergunte sobre a conversa e receba respostas baseadas no que foi dito.
4. Baixe a transcrição quando quiser.

PRIVACIDADE
Suas conversas são cifradas no seu aparelho antes de sair dele. A chave fica só com você, e nem nós conseguimos ler o que você guarda.

Use também no navegador e no computador, com a mesma conta.

O Dito é uma ferramenta de apoio à sua rotina. A responsabilidade pelo uso das informações e pelo consentimento de quem é gravado é sempre sua.
```

### Palavras-chave (máx. 100, separadas por vírgula, sem espaço)

```
transcrição,transcrever,resumo,reunião,ata,consulta,aula,gravador,áudio,voz,anotação,entrevista
```

O nome e o subtítulo já contam na busca, então não se repetem aqui.

### URL de suporte

```
https://dito.albiecloud.com
```

### URL de marketing (opcional)

```
https://dito.albiecloud.com
```

### Direitos autorais

```
2026 Pedro Bartoli
```

---

## Informações do app

### Subtítulo (máx. 30)

```
Transcreve e resume conversas
```

### Categoria

- Principal: **Produtividade**
- Secundária: **Negócios**

### URL da política de privacidade

```
https://dito.albiecloud.com/privacidade.html
```

---

## Revisão de apps (o que o revisor lê)

### Conta de acesso

- Usuário: `playstore.review@dito-app.com`
- Senha: a mesma de `frontend/e2e-store-screenshots.mjs`

A conta já tem três conversas de demonstração e saldo do plano grátis para
gravar e perguntar.

Para o revisor testar a compra, ela precisa estar no plano grátis no momento do
envio. Se um teste anterior deixou um plano pago nela, o revisor não encontra os
botões de assinar — que é exatamente o que ele foi procurar nas duas recusas.

### Notas

```
O Dito grava e transcreve conversas (reuniões, consultas, aulas). O microfone só é usado quando a pessoa toca em gravar. Quem grava é responsável por avisar e ter o consentimento de quem é gravado, e o app diz isso na descrição.

A conta de teste já tem conversas de exemplo. Para testar: toque no microfone, fale por alguns segundos, toque em finalizar e aguarde o resumo. Depois, abra a conversa e faça uma pergunta sobre ela.

Os quatro planos pagos podem ser comprados dentro do app, por In-App Purchase, em "Meu plano" (menu lateral, ou o ícone de conta no celular): Iniciante e Avançado, mensal e anual. A mesma tela tem "Restaurar compras", a frase da renovação automática e os links dos termos de uso e da política de privacidade.

O Dito também é um serviço multiplataforma: a mesma conta é usada no navegador e no aplicativo de Windows, e uma assinatura feita fora do app é reconhecida aqui, como permite a regra 3.1.3(b). Nada dentro do app leva a comprar por fora: não há link, botão nem menção a outra forma de pagamento. Quem já assina por fora vê "Plano atual"; quem não assina compra aqui, pela Apple.

A conta de teste está no plano grátis, então todos os botões de compra aparecem para o revisor.

Para apagar a conta: menu lateral, Configurações, seção Conta, Apagar minha conta.

"Convidar amigos" gera um link pessoal. Quando um amigo cria conta por ele e usa o app, quem convidou ganha minutos extras de uso gratuito. Nada é pago nem sacado.

As conversas são cifradas no aparelho antes de irem ao servidor.
```

---

## Privacidade do app (questionário)

Precisa bater com o `PrivacyInfo.xcprivacy` do app, que declara exatamente
estes quatro tipos. Respostas:

- **Coleta dados?** Sim.
- **Informações de contato → endereço de e-mail:** usado para a funcionalidade
  do app (login). Ligado à identidade. Não usado para rastreamento.
- **Conteúdo do usuário → áudio e outros conteúdos:** usado para a
  funcionalidade do app (transcrever e resumir). Ligado à identidade. Não usado
  para rastreamento. O áudio é processado e não fica guardado; a transcrição fica
  cifrada.
- **Dados de uso → interação com o produto:** análise (contagem de aberturas e
  capturas). Ligado à identidade. Não usado para rastreamento.
- **Rastreamento:** não.
