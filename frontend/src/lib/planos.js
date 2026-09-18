// A régua dos planos, num lugar só. Ela existia em três cópias — a tabela da
// landing, a do "Meu plano" e os limites do aviso de saldo no Layout — e cada
// ajuste de preço ou limite saía errado em pelo menos uma delas.
//
// Os números abaixo são só o DESENHO INICIAL, para a tela ter o que mostrar
// antes de o servidor responder (o Render hiberna) ou se a máquina estiver
// offline. A régua que vale vem de GET /planos, montada em main.py a partir
// dos mesmos limites que barram de verdade. Isso existe porque o app de
// Windows empacota este arquivo dentro do executável e não se atualiza
// sozinho: sem buscar do servidor, um reajuste de preço só chegaria a quem
// reinstalasse o programa na mão.
import { useEffect, useSyncExternalStore } from 'react'
import { API_URL } from './api'

export const PLANOS = [
  {
    id: 'gratuito',
    nome: 'Grátis',
    minutos: 100,
    perguntas: 2,
    completa: false,
    mensal: 0,
    anual: null,
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
    minutos: 250,
    perguntas: 10,
    completa: false,
    mensal: 20,
    anual: 216,
    destaque: true,
    resumo: 'Para quem grava toda semana.',
    cta: 'Assinar Iniciante',
    itens: [
      '250 minutos por mês',
      'Transcrição simples',
      'Limite de 10 perguntas por transcrição',
      'Criptografia de ponta a ponta',
    ],
  },
  {
    id: 'avancado',
    nome: 'Avançado',
    minutos: 800,
    perguntas: null,
    completa: true,
    mensal: 40,
    anual: 432,
    resumo: 'Para quem vive dentro de conversas.',
    cta: 'Assinar Avançado',
    itens: [
      '800 minutos por mês',
      'Transcrição simples e completa',
      'Perguntas ilimitadas por transcrição',
      'Criptografia de ponta a ponta',
    ],
  },
]

// Plano desconhecido (sem assinatura, id antigo) vale como o grátis — é o que o
// backend também faz.
export const planoPorId = id => PLANOS.find(p => p.id === id) || PLANOS[0]

// `PLANOS` é trocado por dentro, e não reatribuído, para que todo mundo que já
// importou a lista (são sete telas) enxergue os valores novos sem precisar de
// mudança nenhuma. O contador é o que avisa o React de que houve troca.
let versao = 0
const ouvintes = new Set()
const assinar = ouvinte => {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

async function carregarPlanos() {
  try {
    const res = await fetch(`${API_URL}/planos`, { cache: 'no-store' })
    if (!res.ok) return
    const { planos } = await res.json()
    if (!Array.isArray(planos) || planos.length === 0) return
    PLANOS.splice(0, PLANOS.length, ...planos)
    versao += 1
    ouvintes.forEach(avisar => avisar())
  } catch {
    // Servidor fora do ar ou máquina offline: fica o desenho inicial, que é
    // melhor do que uma tabela de preços vazia.
  }
}

// Fica no topo da árvore (App.jsx): quando a resposta chega, o App redesenha e
// as telas que leem `PLANOS`/`planoPorId` pegam os valores novos de carona.
export function useReguaDePlanos() {
  useSyncExternalStore(assinar, () => versao)
  useEffect(() => { carregarPlanos() }, [])
}

export const formatarPreco = valor =>
  valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// O preço que a vitrine mostra primeiro: o anual dividido pelo mês. Derivado do
// anual, e não escrito à mão, para a manchete nunca divergir do que é cobrado.
export const precoMensalNoAnual = plano => plano.anual / 12

export const economiaAnual = plano =>
  Math.round((1 - precoMensalNoAnual(plano) / plano.mensal) * 100)
