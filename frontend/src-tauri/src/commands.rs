use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, State};

use crate::audio::{self, RecordingHandle};

#[derive(Default)]
pub struct RecordingState(pub Mutex<Option<RecordingHandle>>);

/// Superfície mínima de propósito: o Rust só entrega "aqui está o .wav";
/// estimativa de tempo, upload, erro de transcrição vazia e sugestão de
/// pasta continuam no JS, sem duplicar lógica (ver Fase 2/3 do plano).
#[tauri::command]
pub fn start_recording(app: AppHandle, state: State<RecordingState>) -> Result<(), String> {
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

    let handle = audio::start_recording(output_path, app)?;
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
