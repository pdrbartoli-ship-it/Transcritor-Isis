import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTheme, setTheme, getIdioma, setIdioma, getNome, setNome, IDIOMAS, TEMA_AUTO } from '../lib/prefs'
import { IconClose, IconSun, IconMoon } from './Icons'
import { rastroAuth } from '../contexts/AuthContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { esquecerDoAparelho } from '../lib/chaves'
import { apagarTudo as apagarIndiceDoAcervo } from '../lib/acervo/indice'
import { apagarConta } from '../lib/api'

// Duas preferências de leitura, no mesmo lugar: como o app aparece (tema) e em
// que língua ele escreve (idioma). Os ajustes de tom, formato e profundidade
// saíram: eram quatro controles que quase ninguém tocava e que faziam a mesma
// captura render resumos diferentes. O resumo agora é sempre neutro e em
// bullets.
//
// No fim, a exclusão da conta. Ela mora aqui porque é onde as lojas mandam
// procurar: a Apple recusa app que deixa criar conta e não deixa apagar, e
// "fale com o suporte" não conta como deixar apagar.
const CONFIRMACAO = 'APAGAR'

export default function SettingsModal({
  onClose, deteccaoDisponivel = false, avisarReuniao = false, onAvisarReuniao,
  iniciarComWindows = null, onIniciarComWindows,
}) {
  const [theme, setThemeState] = useState(getTheme())
  const [idioma, setIdiomaState] = useState(getIdioma())
  const [nome, setNomeState] = useState(getNome)
  const { user } = useAuth()
  const navigate = useNavigate()
  // Três estados, não um booleano: 'fechado' é o link discreto, 'confirmando'
  // é o aviso com a palavra a digitar, 'apagando' trava os dois botões. Com um
  // booleano o botão seguiria vivo durante a chamada, e o segundo clique
  // apagaria uma conta que já não existe — erro incompreensível na tela de
  // quem acabou de acertar.
  const [passo, setPasso] = useState('fechado')
  const [digitado, setDigitado] = useState('')
  const [erro, setErro] = useState('')

  function changeTheme(t) { setThemeState(t); setTheme(t) }
  function changeIdioma(i) { setIdiomaState(i); setIdioma(i) }
  // Guardado a cada tecla: a janela fecha clicando fora, e um botão "Salvar"
  // só para este campo faria a pessoa perder o nome sem perceber.
  function changeNome(n) { setNomeState(n); setNome(n) }

  async function confirmarExclusao() {
    setErro('')
    setPasso('apagando')
    try {
      await apagarConta()
    } catch (e) {
      setErro(e.message || 'Não foi possível apagar sua conta agora. Tente de novo.')
      setPasso('confirmando')
      return
    }
    // A conta já não existe no servidor; o que sobrou é o rastro neste
    // aparelho. A chave sai primeiro porque sem ela nada mais aqui é legível,
    // e o índice do acervo guarda trechos do que foi dito. Falhar em qualquer
    // um deles não desfaz a exclusão, então nenhum deles pode travar a saída.
    try { await esquecerDoAparelho() } catch { /* aparelho sem IndexedDB */ }
    try { await apagarIndiceDoAcervo() } catch { /* idem */ }
    try { await supabase.auth.signOut() } catch { /* sessão já morta */ }
    navigate('/auth', { replace: true, state: { contaApagada: true } })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Configurações</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>

        <div className="settings-group">
          <label>Tema</label>
          {/* "Automático" primeiro: é o padrão de quem nunca escolheu, e é o
              que o resto do aparelho faz. */}
          <div className="seg">
            <button className={theme === TEMA_AUTO ? 'on' : ''} onClick={() => changeTheme(TEMA_AUTO)}>
              Automático
            </button>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => changeTheme('light')}>
              <IconSun width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Claro
            </button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => changeTheme('dark')}>
              <IconMoon width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Escuro
            </button>
          </div>
        </div>

        {/* Quem grava é quase sempre uma das vozes da gravação, e é a única
            que o Dito teria como saber de antemão. Sem isto ela sai como
            "Locutor 1" mesmo quando ninguém diz nome nenhum na conversa. */}
        <div className="settings-group">
          <label htmlFor="settings-nome">Seu nome</label>
          <p className="hint">
            Aparece no lugar de "Locutor 1" quando o Dito reconhece a sua voz na
            gravação. Fica só neste aparelho.
          </p>
          <input
            id="settings-nome"
            type="text"
            value={nome}
            maxLength={60}
            placeholder="Como as pessoas te chamam"
            onChange={e => changeNome(e.target.value)}
            autoComplete="given-name"
          />
        </div>

        {/* A dica não é enfeite: sem ela, "Idioma" numa tela de transcrição é
            lido como o idioma do áudio, e a pessoa muda a opção esperando
            ajudar o Dito a entender a gravação. */}
        <div className="settings-group" style={{ marginBottom: 0 }}>
          <label>Idioma</label>
          <p className="hint">
            Em que língua o Dito escreve os resumos, os tópicos e as tarefas.
            Não importa o idioma do vídeo ou do áudio: o Dito entende qualquer
            um e escreve no que você escolher.
          </p>
          <div className="seg">
            {IDIOMAS.map(({ code, label }) => (
              <button
                key={code}
                className={idioma === code ? 'on' : ''}
                onClick={() => changeIdioma(code)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Só no app de Windows, e só onde o executável já tem o detector: o
            site novo chega ao app antes do instalador novo, e a opção
            apareceria sem fazer nada. */}
        {deteccaoDisponivel && (
          <div className="settings-group" style={{ marginTop: 22 }}>
            <label>Reuniões</label>
            <button
              className={`settings-switch ${avisarReuniao ? 'on' : ''}`}
              role="switch"
              aria-checked={avisarReuniao}
              onClick={() => onAvisarReuniao?.(!avisarReuniao)}
            >
              <span className="settings-switch-texto">Avisar quando uma reunião começar</span>
              <span className="settings-switch-trilho"><span className="settings-switch-bolinha" /></span>
            </button>
            <p className="hint">
              O Dito percebe quando você entra numa reunião do Zoom, Teams ou
              Meet e pergunta se quer gravar. Nada sai do seu computador nessa
              detecção. Avise os participantes antes de gravar.
            </p>

            {/* Só no executável baixado do site (null na versão da Store, onde
                o início acompanha o aviso) e só com o aviso ligado: sem o
                detector não há o que abrir sozinho. */}
            {/* Sem explicação embaixo: o rótulo já diz o que o interruptor faz,
                e contar que o app sobe escondido na bandeja era detalhe de
                implementação que não muda a decisão de ninguém. */}
            {avisarReuniao && iniciarComWindows !== null && (
              <button
                className={`settings-switch ${iniciarComWindows ? 'on' : ''}`}
                role="switch"
                aria-checked={iniciarComWindows}
                onClick={() => onIniciarComWindows?.(!iniciarComWindows)}
              >
                <span className="settings-switch-texto">Abrir o Dito quando o Windows iniciar</span>
                <span className="settings-switch-trilho"><span className="settings-switch-bolinha" /></span>
              </button>
            )}
          </div>
        )}

        {/* Convidado não tem o que apagar: a sessão anônima não guarda e-mail,
            e o caminho dele é criar conta, não encerrar uma. */}
        {user && !user.is_anonymous && (
          <div className="settings-group settings-perigo">
            <label>Conta</label>
            {passo === 'fechado' ? (
              <>
                <p className="hint">
                  Apagar a conta remove suas conversas, sua chave e seu
                  cadastro. Não dá para desfazer.
                </p>
                <button className="btn-perigo-link" onClick={() => setPasso('confirmando')}>
                  Apagar minha conta
                </button>
              </>
            ) : (
              <>
                <p className="hint">
                  Vamos apagar tudo que é seu: as conversas e as transcrições,
                  a chave que as abre, seus minutos do mês e o cadastro de{' '}
                  <strong>{user.email}</strong>. Se você assina um plano, ele é
                  cancelado agora e não haverá nova cobrança. Nada disso volta,
                  nem por nós.
                </p>
                <label className="hint" htmlFor="confirmar-exclusao">
                  Para confirmar, escreva {CONFIRMACAO} abaixo.
                </label>
                <input
                  id="confirmar-exclusao"
                  type="text"
                  value={digitado}
                  onChange={e => setDigitado(e.target.value)}
                  disabled={passo === 'apagando'}
                  autoComplete="off"
                  placeholder={CONFIRMACAO}
                />
                {erro && <div className="alert alert-error">{erro}</div>}
                <div className="perigo-acoes">
                  <button
                    className="btn-secondary"
                    onClick={() => { setPasso('fechado'); setDigitado(''); setErro('') }}
                    disabled={passo === 'apagando'}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn-perigo"
                    onClick={confirmarExclusao}
                    disabled={digitado.trim().toUpperCase() !== CONFIRMACAO || passo === 'apagando'}
                  >
                    {passo === 'apagando' ? 'Apagando…' : 'Apagar para sempre'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Qual build está rodando. Morava no rodapé da barra lateral, onde
            no celular ficava embaixo do indicador de início; aqui continua a
            um toque de quem pergunta "atualizou?". Sem o "Concluído" que
            havia aqui: o × do topo e o toque fora já fecham, e dois jeitos de
            fechar a mesma janela era um a mais. */}
        <p
          className="settings-versao"
          title={`Commit ${__BUILD_SHA__}\nÚltimos eventos de login: ${rastroAuth() || 'nenhum'}`}
        >
          Versão {__APP_VERSION__} · {__BUILD_SHA__}
        </p>
      </div>
    </div>
  )
}
