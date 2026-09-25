import { useState, useRef } from 'react'
import { IconMic, IconFile } from '../Icons'
import { ACCEPTED_FILES, formatTime } from './estimate'
import { RecordingReview, FileReview, UrlForm, GravandoAgora, MODE_TITLE } from './CaptureShared'
import { usePlatform } from '../../lib/platform'
import { temGravadorNativo } from '../../lib/gravadorNativo'

// Com o gravador nativo, a gravação continua com a tela travada ou em outro
// app, e a frase diz isso. Nos apps de loja anteriores a ele a gravação ainda
// é a do navegador embutido, que para quando o Dito sai da tela: o iPhone e o
// Android cortam o microfone de quem está em segundo plano.
const dicaDaTela = () => (temGravadorNativo()
  ? 'Pode travar a tela: o Dito continua gravando.'
  : 'Mantenha o Dito aberto e a tela ligada enquanto grava.')

// Captura no celular. Diferenças reais em relação ao desktop:
// - não existe arrastar arquivo: o alvo vira um botão de toque, sem a área
//   pontilhada que no touch só ocupa espaço e não sugere nada;
// - o vocabulário é "toque", não "clique";
// - o áudio do WhatsApp chega pelo "Compartilhar" do próprio WhatsApp, e é
//   esse o caminho que a aba ensina onde ele existe (Android);
// - o aviso do microfone fala de permissão do aparelho, não do navegador —
//   é lá que o usuário precisa ir resolver.
export default function CaptureNative({ capture, variant, mode = 'record', mini, onVerPlanos }) {
  const {
    loading, error, errorStatus, pendingFile,
    isRecording, isPaused, isFinalizing, recordedBlob, recordingTime, getLevel,
    avisoGravacao,
    startRecording, stopRecording, resetRecording,
    pauseRecording, resumeRecording,
    pickFile, clearFile,
    submitRecording, submitFile, submitUrl,
  } = capture
  const { isAndroid, isNative } = usePlatform()

  const [url, setUrl] = useState('')
  const fileRef = useRef()

  // `modo` aqui é a profundidade da transcrição, não o `mode` do painel (que
  // diz qual origem está aberta) — nomes diferentes para não confundir os dois.
  function handleUrl(modo, duracaoS) {
    if (submitUrl(url, modo, duracaoS)) setUrl('')
  }

  return (
    <>
      {mode === 'record' && (
        <div className="hero-record">
          {recordedBlob ? (
            <RecordingReview
              recordingTime={recordingTime}
              onSubmit={submitRecording}
              onReset={resetRecording}
              loading={loading}
              aviso={avisoGravacao}
            />
          ) : isRecording ? (
            <GravandoAgora
              recordingTime={recordingTime}
              isPaused={isPaused}
              getLevel={getLevel}
              onStop={stopRecording}
              onPause={pauseRecording}
              onResume={resumeRecording}
              mini={mini}
              dica={avisoGravacao || (variant === 'hero' ? dicaDaTela() : null)}
            />
          ) : isFinalizing ? (
            <p className="record-label">
              <span className="spinner spinner-sm" /> Finalizando a gravação · {formatTime(recordingTime)}
            </p>
          ) : (
            <>
              <button
                className={`record-btn ${variant === 'hero' ? 'hero' : ''}`}
                onClick={startRecording}
                disabled={loading}
                aria-label="Iniciar gravação"
              >
                <IconMic width={26} height={26} />
              </button>
              <p className="record-label">Toque para gravar</p>
              {variant === 'hero' && <p className="mic-hint">{dicaDaTela()}</p>}
            </>
          )}
        </div>
      )}

      {mode === 'file' && (
        <div className="capture-mode">
          <p className="capture-mode-title">{MODE_TITLE.file}</p>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_FILES}
            style={{ display: 'none' }}
            onChange={e => pickFile(e.target.files[0])}
          />
          {pendingFile ? (
            <FileReview
              pendingFile={pendingFile}
              onSubmit={submitFile}
              onReset={() => { clearFile(); fileRef.current.value = '' }}
              loading={loading}
            />
          ) : isNative && isAndroid ? (
            // No Android o Dito aparece no "Compartilhar" do WhatsApp: é o
            // caminho curto, e a aba o ensina antes de oferecer o arquivo.
            <>
              <ol className="passos-whatsapp">
                <li>No WhatsApp, toque e segure o áudio</li>
                <li>Toque em <strong>Compartilhar</strong></li>
                <li>Escolha o <strong>Dito</strong></li>
              </ol>
              <button className="btn-link" onClick={() => !loading && fileRef.current?.click()} disabled={loading}>
                Ou escolha um arquivo do celular
              </button>
            </>
          ) : (
            <>
              <button
                className="pick-file"
                onClick={() => !loading && fileRef.current?.click()}
                disabled={loading}
              >
                <IconFile width={18} height={18} />
                Escolher áudio ou vídeo
              </button>
              <p className="text-muted text-sm pick-file-hint">
                {isNative
                  ? 'Do WhatsApp: toque e segure o áudio, toque em Encaminhar e no botão de compartilhar, e salve em Arquivos. Depois escolha aqui.'
                  : 'Áudio do WhatsApp, gravação de reunião ou vídeo salvo no celular.'}
              </p>
            </>
          )}
        </div>
      )}

      {mode === 'url' && (
        <div className="capture-mode">
          <p className="capture-mode-title">{MODE_TITLE.url}</p>
          <UrlForm url={url} setUrl={setUrl} onSubmit={handleUrl} loading={loading} />
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          {error}
          {/* Saldo esgotado não é um erro para "tentar de novo": o caminho de
              saída é assinar, e ele fica a um clique da mensagem. */}
          {errorStatus === 402 && onVerPlanos && (
            <button type="button" className="btn-primary alert-cta" onClick={onVerPlanos}>
              Ver planos
            </button>
          )}
        </div>
      )}
    </>
  )
}
