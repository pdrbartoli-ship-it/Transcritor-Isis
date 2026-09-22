use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, State};

use crate::audio::{self, RecordingHandle};
use crate::meeting::{self, Detector};

#[derive(Default)]
pub struct RecordingState(pub Mutex<Option<RecordingHandle>>);

/// Fechar a janela esconde em vez de encerrar. Vive aqui, e não no JS, porque
/// quem trata o `CloseRequested` é o Rust (ver lib.rs).
#[derive(Default)]
pub struct BackgroundMode(pub AtomicBool);

/// Superfície mínima de propósito: o Rust só entrega "aqui está o .wav";
/// estimativa de tempo, upload, erro de transcrição vazia e sugestão de
/// pasta continuam no JS, sem duplicar lógica (ver Fase 2/3 do plano).
/// `max_seconds` vem do saldo de minutos do mês (o JS lê antes de chamar) e é
/// o que impede uma reunião de duas horas virar um 402 depois do upload: o
/// backend só recusa no fim, medindo a duração do arquivo. Sem saldo legível o
/// JS manda `None` e a gravação corre sem teto, como antes.
#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<RecordingState>,
    max_seconds: Option<u64>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "estado de gravação corrompido".to_string())?;
    if guard.is_some() {
        return Err("já existe uma gravação em andamento".into());
    }

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let output_path = dir.join(format!("gravacao-{timestamp}.wav"));

    let handle = audio::start_recording(output_path, app, max_seconds)?;
    *guard = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_recording(state: State<RecordingState>) -> Result<String, String> {
    let handle = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "estado de gravação corrompido".to_string())?;
        guard
            .take()
            .ok_or_else(|| "nenhuma gravação em andamento".to_string())?
    };

    let path = handle.output_path().to_string_lossy().to_string();
    handle.stop()?;
    Ok(path)
}

/// Pausa/retoma a gravação em andamento. Devolve o estado resultante, para o
/// JS não precisar torcer para o seu palpite bater com o do Rust.
#[tauri::command]
pub fn set_recording_paused(paused: bool, state: State<RecordingState>) -> Result<bool, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "estado de gravação corrompido".to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "nenhuma gravação em andamento".to_string())?;
    handle.set_paused(paused);
    Ok(handle.is_paused())
}

/// Liga ou desliga o detector de reunião. Nasce desligado: quem liga é o JS,
/// lendo a preferência que a pessoa marcou em Configurações. Gravar sem querer
/// numa consulta ou numa audiência é um estrago que não se desfaz, então o
/// padrão tem de ser o silêncio.
#[tauri::command]
pub fn set_meeting_detection(app: AppHandle, enabled: bool, detector: State<Detector>) {
    detector.definir(&app, enabled);
}

/// O site novo chega ao app antes do instalador novo. Sem esta pergunta, a
/// opção apareceria nas Configurações de quem tem um executável sem detector.
#[tauri::command]
pub fn meeting_detection_available() -> bool {
    meeting::disponivel()
}

/// Com o modo de bandeja ligado, fechar a janela esconde em vez de encerrar —
/// inclusive no meio de uma gravação. Sem isto o detector só existiria com o
/// app aberto na tela, que é justamente quando a pessoa menos precisa dele.
/// Liga junto o início com o Windows, pelo mesmo interruptor.
#[tauri::command]
pub fn set_background_mode(app: AppHandle, enabled: bool, state: State<BackgroundMode>) {
    state.0.store(enabled, Ordering::SeqCst);

    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    let resultado = if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    };
    if let Err(err) = resultado {
        // Num pacote MSIX a chave `Run` não vale, e o autostart falha. O resto
        // do recurso continua de pé: a pessoa abre o Dito e ele fica na
        // bandeja. Ver a nota sobre StartupTask no plano.
        log::warn!("não foi possível ajustar o início com o Windows: {err}");
    }
}
