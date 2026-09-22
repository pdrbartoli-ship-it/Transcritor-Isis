mod audio;
mod commands;
mod meeting;

use std::sync::atomic::Ordering;

use commands::{BackgroundMode, RecordingState};
use meeting::Detector;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

/// Argumento de linha de comando do início com o Windows: o Dito sobe sem
/// mostrar a janela, só com o ícone na bandeja, para o detector já estar de pé
/// sem a máquina abrir um app na cara de quem ligou o computador.
const ARG_MINIMIZADO: &str = "--minimizado";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Precisa ser o primeiro plugin registrado. Abrir o Dito de novo (pelo
    // atalho, pelo instalador) traz de volta a janela que já está rodando, em
    // vez de subir um segundo app com um segundo detector.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      mostrar_principal(app);
    }))
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec![ARG_MINIMIZADO]),
    ))
    .manage(RecordingState::default())
    .manage(BackgroundMode::default())
    .manage(Detector::default())
    .invoke_handler(tauri::generate_handler![
      commands::start_recording,
      commands::stop_recording,
      commands::set_recording_paused,
      commands::set_meeting_detection,
      commands::meeting_detection_available,
      commands::set_background_mode,
    ])
    // Com o modo de bandeja ligado, o X esconde a janela em vez de encerrar o
    // app — inclusive durante uma gravação, que é quando encerrar seria pior.
    .on_window_event(|window, event| {
      if !matches!(event, WindowEvent::CloseRequested { .. }) || window.label() != "main" {
        return;
      }
      let modo = window.app_handle().state::<BackgroundMode>();
      if !modo.0.load(Ordering::SeqCst) {
        return;
      }
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      montar_bandeja(app.handle())?;

      // Subiu pelo início com o Windows: some da tela, mas continua de pé.
      if std::env::args().any(|arg| arg == ARG_MINIMIZADO) {
        if let Some(janela) = app.get_webview_window("main") {
          let _ = janela.hide();
        }
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// Ícone da bandeja. Duas entradas e nada mais: "Abrir o Dito" e "Sair" são as
/// duas perguntas que alguém faz ao ver um ícone ali.
fn montar_bandeja(app: &AppHandle) -> tauri::Result<()> {
  let abrir = MenuItem::with_id(app, "abrir", "Abrir o Dito", true, None::<&str>)?;
  let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&abrir, &sair])?;

  let mut builder = TrayIconBuilder::with_id("dito")
    .tooltip("Dito")
    .menu(&menu)
    // O clique esquerdo mostra a janela; o menu é o do botão direito, como em
    // qualquer outro ícone de bandeja do Windows.
    .show_menu_on_left_click(false)
    .on_menu_event(|app, evento| match evento.id.as_ref() {
      "abrir" => mostrar_principal(app),
      // Sair é sair de verdade: sem isto o modo de bandeja deixaria o app sem
      // nenhuma saída a não ser o gerenciador de tarefas.
      "sair" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, evento| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = evento
      {
        mostrar_principal(tray.app_handle());
      }
    });

  if let Some(icone) = app.default_window_icon() {
    builder = builder.icon(icone.clone());
  }
  // O ícone fica registrado no próprio app; soltar o valor aqui não o tira da
  // bandeja.
  let _ = builder.build(app)?;
  Ok(())
}

/// Mostrar, tirar do minimizado e focar — os três, nesta ordem. Só `show()`
/// deixa a janela escondida atrás das outras se ela tinha sido minimizada.
fn mostrar_principal(app: &AppHandle) {
  if let Some(janela) = app.get_webview_window("main") {
    let _ = janela.show();
    let _ = janela.unminimize();
    let _ = janela.set_focus();
  }
}
