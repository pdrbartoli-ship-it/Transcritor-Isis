// Captura de áudio via WASAPI (Windows): microfone + loopback do dispositivo
// de saída padrão, cada um em sua própria thread, misturados numa thread
// mixer/writer que escreve incrementalmente um .wav (ver Fase 2 do plano de
// migração pra app nativo).
//
// Formato pedido a cada dispositivo: 48kHz mono f32. `StreamMode::EventsShared
// { autoconvert: true, .. }` deixa o próprio engine de áudio do Windows (modo
// compartilhado) fazer o resample/downmix pra esse formato — por isso não
// precisamos rodar resample manual (rubato) nem downmix estéreo→mono aqui.
use crossbeam_channel::{bounded, Receiver, RecvTimeoutError, Sender};
use hound::{SampleFormat, WavSpec, WavWriter};
use std::collections::VecDeque;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

// 16 kHz é a taxa nativa do Whisper — ele reamostra tudo para cá de qualquer
// jeito, então gravar em 48 kHz só produzia arquivo três vezes maior sem uma
// única palavra a mais de qualidade. Em WAV 16 bits mono isso é a diferença
// entre 345 MB e 115 MB por hora de reunião. O `autoconvert: true` do WASAPI
// (ver capture_stream) faz a reamostragem, então nada mais muda aqui.
const SAMPLE_RATE: u32 = 16_000;
const CHANNELS: u16 = 1;
/// Quanto tempo esperamos pelo primeiro dado de cada stream antes de decidir
/// se um dispositivo está mesmo disponível (usado só pra decidir se
/// `start_recording` deve falhar por falta de mic *e* de saída de áudio).
const STARTUP_PROBE: Duration = Duration::from_millis(300);
/// De quanto em quanto tempo o nível de áudio vai para a janelinha. 100ms dá
/// dez quadros por segundo — o bastante para a onda parecer viva sem inundar a
/// ponte de eventos.
const LEVEL_INTERVAL: Duration = Duration::from_millis(100);

pub struct RecordingHandle {
    output_path: PathBuf,
    stop_flag: Arc<AtomicBool>,
    pause_flag: Arc<AtomicBool>,
    mic_handle: Option<JoinHandle<()>>,
    system_handle: Option<JoinHandle<()>>,
    mixer_handle: Option<JoinHandle<Result<(), String>>>,
}

impl RecordingHandle {
    pub fn output_path(&self) -> &PathBuf {
        &self.output_path
    }

    /// Pausar NÃO fecha os streams do WASAPI: os dispositivos seguem abertos e
    /// entregando amostras, e é o mixer que para de escrevê-las no .wav. Fechar
    /// e reabrir o dispositivo a cada pausa é justamente onde moram os bugs de
    /// áudio (perfil de headset que troca, dispositivo que some), então o
    /// caminho barato aqui também é o mais seguro.
    pub fn set_paused(&self, paused: bool) {
        self.pause_flag.store(paused, Ordering::SeqCst);
    }

    pub fn is_paused(&self) -> bool {
        self.pause_flag.load(Ordering::SeqCst)
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(h) = self.mic_handle.take() {
            let _ = h.join();
        }
        if let Some(h) = self.system_handle.take() {
            let _ = h.join();
        }
        match self.mixer_handle.take() {
            Some(h) => h
                .join()
                .map_err(|_| "thread de mixagem entrou em pânico".to_string())?,
            None => Ok(()),
        }
    }
}

pub fn start_recording(output_path: PathBuf, app: AppHandle) -> Result<RecordingHandle, String> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let pause_flag = Arc::new(AtomicBool::new(false));

    let (mic_tx, mic_rx) = bounded::<Vec<f32>>(64);
    let (sys_tx, sys_rx) = bounded::<Vec<f32>>(64);

    let mic_had_data = Arc::new(AtomicBool::new(false));
    let sys_had_data = Arc::new(AtomicBool::new(false));

    let mic_handle = {
        let stop_flag = stop_flag.clone();
        let had_data = mic_had_data.clone();
        let app = app.clone();
        thread::Builder::new()
            .name("capture-mic".into())
            .spawn(move || {
                run_capture_with_retry(false, mic_tx, stop_flag, had_data, app, "microfone")
            })
            .map_err(|e| e.to_string())?
    };

    let system_handle = {
        let stop_flag = stop_flag.clone();
        let had_data = sys_had_data.clone();
        let app = app.clone();
        thread::Builder::new()
            .name("capture-system".into())
            .spawn(move || {
                run_capture_with_retry(true, sys_tx, stop_flag, had_data, app, "áudio do sistema")
            })
            .map_err(|e| e.to_string())?
    };

    // Espera um instante pro caso mais comum de falta de dispositivo (nenhum
    // microfone plugado, ou nenhum dispositivo de saída padrão) já aparecer
    // antes de decidir se a gravação pode começar.
    thread::sleep(STARTUP_PROBE);
    if !mic_had_data.load(Ordering::SeqCst)
        && !sys_had_data.load(Ordering::SeqCst)
        && mic_handle.is_finished()
        && system_handle.is_finished()
    {
        stop_flag.store(true, Ordering::SeqCst);
        let _ = mic_handle.join();
        let _ = system_handle.join();
        return Err(
            "nenhum microfone nem dispositivo de saída de áudio disponível para gravar".into(),
        );
    }

    let mixer_handle = {
        let output_path = output_path.clone();
        let pause_flag = pause_flag.clone();
        let app = app.clone();
        thread::Builder::new()
            .name("audio-mixer".into())
            .spawn(move || mixer_loop(output_path, mic_rx, sys_rx, pause_flag, app))
            .map_err(|e| e.to_string())?
    };

    Ok(RecordingHandle {
        output_path,
        stop_flag,
        pause_flag,
        mic_handle: Some(mic_handle),
        system_handle: Some(system_handle),
        mixer_handle: Some(mixer_handle),
    })
}

/// Roda `capture_stream`, tentando reinicializar uma vez se o stream cair no
/// meio da gravação (ex. troca de perfil de um headset Bluetooth). Se a
/// segunda tentativa também falhar, esse stream para de vez e — só se ele
/// chegou a produzir áudio antes — avisa o JS via evento `recording-warning`
/// pra não confundir o caso "nunca teve esse dispositivo" com "desconectou
/// no meio".
fn run_capture_with_retry(
    is_loopback: bool,
    tx: Sender<Vec<f32>>,
    stop_flag: Arc<AtomicBool>,
    had_data: Arc<AtomicBool>,
    app: AppHandle,
    stream_label: &'static str,
) {
    for _ in 0..2 {
        if stop_flag.load(Ordering::SeqCst) {
            return;
        }
        match capture_stream(is_loopback, tx.clone(), stop_flag.clone(), had_data.clone()) {
            Ok(()) => return,
            Err(err) => {
                log::warn!("captura de {stream_label} interrompida: {err}");
            }
        }
    }
    if had_data.load(Ordering::SeqCst) && !stop_flag.load(Ordering::SeqCst) {
        let _ = app.emit(
            "recording-warning",
            format!(
                "A captura de {stream_label} parou no meio da gravação (dispositivo \
                 desconectado ou indisponível). O restante continua sendo gravado normalmente."
            ),
        );
    }
}

/// Abre o dispositivo padrão (`Direction::Capture` = microfone,
/// `Direction::Render` = loopback do que está tocando no dispositivo de
/// saída padrão) e envia blocos de amostras f32 mono/48kHz pro `tx` até que
/// `stop_flag` seja marcado ou o dispositivo pare de responder.
fn capture_stream(
    is_loopback: bool,
    tx: Sender<Vec<f32>>,
    stop_flag: Arc<AtomicBool>,
    had_data: Arc<AtomicBool>,
) -> Result<(), String> {
    // Direction::Capture = microfone (captura normal); Direction::Render =
    // loopback do dispositivo de saída padrão (o "system audio").
    let direction = if is_loopback {
        Direction::Render
    } else {
        Direction::Capture
    };

    // initialize_mta() devolve um HRESULT puro, não um Result — .ok() converte
    // pro Result<(), windows_result::Error> antes do map_err de sempre.
    wasapi::initialize_mta()
        .ok()
        .map_err(|e| format!("falha ao inicializar COM (MTA): {e:?}"))?;

    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let device = enumerator
        .get_default_device(&direction)
        .map_err(|e| e.to_string())?;
    let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;

    let desired_format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        SAMPLE_RATE as usize,
        CHANNELS as usize,
        None,
    );
    let blockalign = desired_format.get_blockalign() as usize;

    let (_, min_time) = audio_client.get_device_period().map_err(|e| e.to_string())?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_time,
    };
    audio_client
        .initialize_client(&desired_format, &direction, &mode)
        .map_err(|e| e.to_string())?;

    let h_event = audio_client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| e.to_string())?;

    audio_client.start_stream().map_err(|e| e.to_string())?;

    let mut byte_queue: VecDeque<u8> = VecDeque::new();
    let mut event_failed = false;

    while !stop_flag.load(Ordering::SeqCst) {
        capture_client
            .read_from_device_to_deque(&mut byte_queue)
            .map_err(|e| e.to_string())?;

        if byte_queue.len() >= blockalign {
            let frame_count = byte_queue.len() / blockalign;
            let mut samples = Vec::with_capacity(frame_count);
            for _ in 0..frame_count {
                let bytes: Vec<u8> = byte_queue.drain(..blockalign).collect();
                samples.push(f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]));
            }
            had_data.store(true, Ordering::SeqCst);
            if tx.send(samples).is_err() {
                break;
            }
        }

        if h_event.wait_for_event(500).is_err() {
            event_failed = true;
            break;
        }
    }

    let _ = audio_client.stop_stream();

    if event_failed && !stop_flag.load(Ordering::SeqCst) {
        return Err("tempo esgotado esperando evento de áudio do dispositivo".to_string());
    }
    Ok(())
}

/// Manda o pico acumulado para o JS e zera o acumulador, no máximo uma vez a
/// cada `LEVEL_INTERVAL`. Chamado a cada volta do mixer; é ele que decide se
/// já é hora de emitir, para a decisão não ficar repetida nos dois pontos de
/// chamada (gravando e pausado).
fn emit_level(app: &AppHandle, peak: &mut f32, last_at: &mut Instant) {
    if last_at.elapsed() < LEVEL_INTERVAL {
        return;
    }
    let _ = app.emit("recording-level", *peak);
    *peak = 0.0;
    *last_at = Instant::now();
}

/// Recebe blocos de amostras dos dois streams, soma+clampa amostra a
/// amostra (com silêncio no lado que não tiver dado disponível — é assim
/// que a degradação graciosa acontece: sem um dos dois streams, o outro
/// grava normalmente) e escreve incrementalmente no .wav de saída.
fn mixer_loop(
    output_path: PathBuf,
    mic_rx: Receiver<Vec<f32>>,
    sys_rx: Receiver<Vec<f32>>,
    pause_flag: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<(), String> {
    let spec = WavSpec {
        channels: CHANNELS,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let file = File::create(&output_path).map_err(|e| e.to_string())?;
    let mut writer = WavWriter::new(BufWriter::new(file), spec).map_err(|e| e.to_string())?;

    let poll_timeout = Duration::from_millis(50);
    // O nível vai para a janelinha desenhar a onda. Só o pico de cada janela de
    // ~100ms é enviado: um evento por bloco de amostras seriam centenas por
    // segundo para alimentar cinco barrinhas, e o olho não vê diferença.
    let mut level_peak: f32 = 0.0;
    let mut last_level_at = Instant::now();

    loop {
        let mic_result = mic_rx.recv_timeout(poll_timeout);
        let sys_result = sys_rx.recv_timeout(poll_timeout);

        let mic_disconnected = matches!(mic_result, Err(RecvTimeoutError::Disconnected));
        let sys_disconnected = matches!(sys_result, Err(RecvTimeoutError::Disconnected));

        if mic_disconnected && sys_disconnected {
            break;
        }

        let mic_samples = mic_result.unwrap_or_default();
        let sys_samples = sys_result.unwrap_or_default();

        // Em pausa as amostras são recebidas e descartadas: os canais precisam
        // continuar sendo drenados (senão os `bounded(64)` enchem e travam as
        // threads de captura), mas nada do trecho pausado entra no arquivo.
        if pause_flag.load(Ordering::SeqCst) {
            // Zerado, e não simplesmente sem emitir: sem isto a onda congelaria
            // no último nível em vez de baixar quando a gravação pausa.
            level_peak = 0.0;
            emit_level(&app, &mut level_peak, &mut last_level_at);
            continue;
        }

        let len = mic_samples.len().max(sys_samples.len());

        for i in 0..len {
            let mic_sample = mic_samples.get(i).copied().unwrap_or(0.0);
            let sys_sample = sys_samples.get(i).copied().unwrap_or(0.0);
            let mixed = (mic_sample + sys_sample).clamp(-1.0, 1.0);
            level_peak = level_peak.max(mixed.abs());
            let sample_i16 = (mixed * i16::MAX as f32) as i16;
            writer
                .write_sample(sample_i16)
                .map_err(|e| e.to_string())?;
        }

        emit_level(&app, &mut level_peak, &mut last_level_at);
    }

    writer.finalize().map_err(|e| e.to_string())?;
    Ok(())
}
