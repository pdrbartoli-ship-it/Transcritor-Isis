// A régua dos planos, num lugar só. Ela existia em três cópias — a tabela da
// landing, a do "Meu plano" e os limites do aviso de saldo no Layout — e cada
// ajuste de preço ou limite saía errado em pelo menos uma delas.
//
// Quem BARRA de verdade é o backend (main.py: LIMITES_PLANO,
// PERGUNTAS_POR_TRANSCRICAO, PLANOS_COM_COMPLETA). Aqui os números só desenham
// a tela: mudou um lá, muda aqui.
export const PLANOS = [
  {
    id: 'gratuito',
    nome: 'Grátis',
    minutos: 100,
    perguntas: 2,
    completa: false,
    precoMensal: 'R$ 0',
    resumo: 'Para experimentar sem compromisso.',
    cta: 'Começar grátis',
    itens: [
      '100 minutos por mês',
      'Transcrição simples',
      'Limite de 2 perguntas por transcrição',
      'Criptografia de ponta a ponta',
    ],
  },
  {
    id: 'iniciante',
    nome: 'Iniciante',
    minutos: 1000,
    perguntas: 10,
    completa: true,
    precoMensal: 'R$ 14,99',
    precoAnual: 'R$ 135',
    destaque: true,
    resumo: 'Para quem grava toda semana.',
    cta: 'Assinar Iniciante',
    itens: [
      '1000 minutos por mês',
      'Transcrição simples e completa',
      'Limite de 10 perguntas por transcrição',
      'Criptografia de ponta a ponta',
    ],
  },
  {
    id: 'avancado',
    nome: 'Avançado',
    minutos: 2000,
    perguntas: null,
    completa: true,
    precoMensal: 'R$ 19,99',
    precoAnual: 'R$ 180',
    resumo: 'Para quem vive dentro de conversas.',
    cta: 'Assinar Avançado',
    itens: [
      '2000 minutos por mês',
      'Transcrição simples e completa',
      'Criptografia de ponta a ponta',
    ],
  },
]

// Plano desconhecido (sem assinatura, id antigo) vale como o grátis — é o que o
// backend também faz.
export const planoPorId = id => PLANOS.find(p => p.id === id) || PLANOS[0]
