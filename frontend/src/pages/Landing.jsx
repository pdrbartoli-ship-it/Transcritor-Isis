import { useNavigate } from 'react-router-dom'
import { IconDownload, IconShield, IconMic, IconFile, IconCheck, IconArrowRight } from '../components/Icons'

// Instalador do app nativo Windows, publicado pelo CI numa GitHub Release a
// cada push na main (ver .github/workflows/build-desktop.yml). Tag fixa
// "desktop-latest" e nome de arquivo fixo "Dito-setup.exe": antes o nome
// carregava a versão do app, então subir a versão quebrava este botão em
// silêncio. Não dá para usar /releases/latest/ porque a release é prerelease.
const INSTALLER_URL = 'https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/download/desktop-latest/Dito-setup.exe'

// A página tem UM caminho principal — entrar e usar pelo navegador — porque o
// download é justamente a fricção que impede o visitante de ver valor. O app
// de Windows não compete com esse botão: ele aparece mais abaixo, numa seção
// própria, para quem atende online e precisa gravar as duas vozes da chamada.
// Quem se reconhece ali se auto-seleciona; quem não, segue no fluxo curto.
export default function Landing() {
  const navigate = useNavigate()
  const entrar = () => navigate('/auth')

  return (
    <div className="lp">
      <header className="lp-nav">
        <span className="brand">Dito<span className="dot">.</span></span>
        <button className="btn-ghost lp-nav-btn" onClick={entrar}>Entrar</button>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-hero-text">
            <h1>Você atende.<br />O Dito escreve.</h1>
            <p className="lp-sub">
              Grave a consulta ou envie um áudio que já tem. Em minutos você recebe a
              transcrição e um resumo do que importa — tudo separado por paciente ou cliente.
            </p>
            <div className="lp-cta">
              <button className="btn-primary lp-btn-lg" onClick={entrar}>
                Começar agora
                <IconArrowRight width={16} height={16} />
              </button>
              <span className="lp-cta-note">Grátis. Direto no navegador, sem instalar nada.</span>
            </div>
          </div>

          {/* O "ponto de ativação": em vez de um print, a própria interface
              desenhada em HTML com os tokens do app. Fica nítida em qualquer
              tela, acompanha o tema claro/escuro e pesa quase nada. Quando
              houver um vídeo real da gravação, ele substitui este bloco. */}
          <div className="lp-shot" aria-hidden="true">
            <div className="lp-shot-bar">
              <span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" />
            </div>
            <div className="lp-shot-body">
              <div className="lp-shot-head">
                <IconMic width={14} height={14} />
                <span>Sessão de 12/09 · 48 min</span>
              </div>
              <div className="lp-wave">
                {Array.from({ length: 34 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
              </div>
              <div className="lp-card">
                <h4>Resumo</h4>
                <ul>
                  <li>Retorno após três semanas; relata melhora no sono.</li>
                  <li>Ajuste de dose combinado para a próxima consulta.</li>
                  <li>Encaminhamento solicitado — pendente.</li>
                </ul>
              </div>
              <div className="lp-lines">
                <span style={{ width: '92%' }} /><span style={{ width: '78%' }} />
                <span style={{ width: '85%' }} /><span style={{ width: '54%' }} />
              </div>
            </div>
          </div>
        </section>

        {/* Fatos verificáveis, não elogios. Depoimentos entram aqui assim que
            houver autorização dos testadores — nome e profissão de verdade. */}
        <div className="lp-strip">
          <span><IconShield width={14} height={14} /> Cifrado no seu aparelho</span>
          <span><IconFile width={14} height={14} /> Áudio, vídeo ou link</span>
          <span><IconCheck width={14} height={14} /> Documento pronto para baixar</span>
        </div>

        {/* ── Como funciona ────────────────────────────────── */}
        <section className="lp-section">
          <h2>Três passos. Nenhum trabalho seu.</h2>
          <ol className="lp-steps">
            <li>
              <span className="lp-num">1</span>
              <h3>Envie o áudio</h3>
              <p>Grave na hora, mande um arquivo que já tem ou cole um link. No celular, dá para compartilhar direto do WhatsApp.</p>
            </li>
            <li>
              <span className="lp-num">2</span>
              <h3>Receba pronto</h3>
              <p>O Dito transcreve e resume sozinho. Você abre e já encontra o que precisa, sem reouvir uma hora de gravação.</p>
            </li>
            <li>
              <span className="lp-num">3</span>
              <h3>Pergunte o que quiser</h3>
              <p>“O que ficou combinado?” — o Dito responde com base na própria conversa. E entrega o documento final quando você pedir.</p>
            </li>
          </ol>
        </section>

        {/* ── Privacidade: o diferencial ───────────────────── */}
        <section className="lp-section lp-privacy">
          <div className="lp-privacy-inner">
            <IconShield width={26} height={26} />
            <h2>O que você grava sai embaralhado daqui.</h2>
            <p>
              O conteúdo das suas conversas é cifrado dentro do seu próprio aparelho, antes de
              subir. A chave que abre nasce e fica com você — ela nunca chega ao nosso servidor.
              Na prática: nem nós conseguimos ler o que você guarda no Dito.
            </p>
            <p className="lp-privacy-foot">
              Feito para quem tem sigilo profissional a cumprir.{' '}
              <a href="/privacidade.html">Política de privacidade</a>
            </p>
          </div>
        </section>

        {/* ── Desktop: público que se auto-seleciona ───────── */}
        <section className="lp-section lp-desktop">
          <div>
            <span className="lp-tag">App para Windows</span>
            <h2>Atende online? Grave a chamada inteira.</h2>
            <p>
              O navegador só escuta o seu microfone. O app do Dito para Windows grava as
              <strong> duas vozes</strong> — a sua e a de quem está do outro lado — em teleconsultas
              e reuniões, com uma janelinha flutuante que fica por cima de tudo enquanto você atende.
            </p>
            <a className="btn-ghost lp-btn-lg" href={INSTALLER_URL}>
              <IconDownload width={16} height={16} />
              Baixar para Windows
            </a>
          </div>
        </section>

        {/* ── Para quem é ──────────────────────────────────── */}
        <section className="lp-section">
          <h2>Feito para quem vive de escutar.</h2>
          <div className="lp-who">
            <div><h3>Psicólogos</h3><p>Sessões registradas sem quebrar o contato visual com o paciente.</p></div>
            <div><h3>Médicos</h3><p>A consulta vira evolução escrita enquanto você atende o próximo.</p></div>
            <div><h3>Advogados</h3><p>Depoimentos e reuniões com transcrição e resumo em minutos.</p></div>
          </div>
        </section>

        {/* ── CTA final ────────────────────────────────────── */}
        <section className="lp-final">
          <h2>Sua próxima conversa pode já ficar registrada.</h2>
          <button className="btn-primary lp-btn-lg" onClick={entrar}>
            Começar agora
            <IconArrowRight width={16} height={16} />
          </button>
          <span className="lp-cta-note">Grátis. Leva menos de um minuto.</span>
        </section>
      </main>

      <footer className="lp-foot">
        <span className="brand">Dito<span className="dot">.</span></span>
        <span>
          <a href="/privacidade.html">Privacidade</a>
          <a href="mailto:pdrbartoli@gmail.com">Fale com a gente</a>
        </span>
      </footer>
    </div>
  )
}
