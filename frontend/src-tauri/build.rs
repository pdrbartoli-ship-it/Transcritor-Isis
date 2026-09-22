fn main() {
  // A janela abre o site publicado (app.windows[].url no tauri.conf.json), e o
  // Tauri recusa os comandos do app vindos de uma página remota a menos que
  // eles estejam declarados aqui e liberados para o domínio numa capability —
  // é o que capabilities/default.json faz com o `remote`. Sem isto, o app abre
  // normalmente e só a gravação falha, com "not allowed by ACL".
  let comandos = tauri_build::AppManifest::new().commands(&[
    "start_recording",
    "stop_recording",
    "set_recording_paused",
    "set_meeting_detection",
    "meeting_detection_available",
    "set_background_mode",
  ]);
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(comandos))
    .expect("falha ao preparar o build do Tauri");
}
