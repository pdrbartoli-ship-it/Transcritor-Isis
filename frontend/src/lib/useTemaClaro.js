import { useEffect } from 'react'
import { aplicarTemaDaVitrine } from './prefs'

// Deixa a tela clara enquanto ela estiver montada. Usado pelas telas deslogadas
// (landing, entrar, confirmar e-mail), que são a primeira imagem do Dito.
//
// Não desfaz nada ao sair: quem devolve o tema escolhido é o Layout, ao entrar
// no app. Restaurar no desmonte fazia a tela piscar entre os dois temas a cada
// remontagem.
export default function useTemaClaro() {
  useEffect(() => { aplicarTemaDaVitrine() }, [])
}
