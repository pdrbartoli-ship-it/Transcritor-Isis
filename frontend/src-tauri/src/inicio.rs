//! Início com o Windows — o interruptor que faz o Dito voltar sozinho depois
//! de a pessoa reiniciar o computador.
//!
//! Há dois Windows aqui, e eles não aceitam a mesma resposta:
//!
//! - No instalador .exe (o do GitHub), quem inicia programas é a chave `Run`
//!   do registro, que o `tauri-plugin-autostart` escreve.
//! - Dentro do pacote MSIX (o da Microsoft Store), essa chave é ignorada. O
//!   Windows só inicia o que está declarado como `windows.startupTask` no
//!   AppxManifest, e a declaração sozinha não basta: nasce desligada e quem
//!   liga é o próprio app, pelo WinRT (`StartupTask::RequestEnableAsync`).
//!
//! O mesmo binário roda nos dois casos, então a escolha é em tempo de
//! execução: `empacotado()` pergunta ao Windows se estamos dentro de um
//! pacote. O `--minimizado` (ver lib.rs) chega dos dois jeitos — do plugin
//! pela configuração em lib.rs, do pacote pelo `uap10:Parameters` do
//! manifesto.
//!
//! Nada aqui pode derrubar o modo bandeja: o detector de reunião funciona com
//! o Dito aberto mesmo que o início automático seja negado, e é isso que a
//! pessoa perde — voltar sozinho, não o recurso.
//!
//! Os dois também não pedem o mesmo cuidado. No pacote, ligar junto com o
//! detector é inofensivo: a Microsoft assinou o pacote e o Windows sabe de
//! onde ele veio. Fora dele, um executável sem assinatura que grava a chave
//! `Run` logo na primeira abertura se comporta exatamente como um vírus, e foi
//! assim que o Defender barrou o instalador em 24/09/2026
//! (`Behavior:Win32/Persistence.A!ml`). Por isso, fora do pacote, a chave só é
//! gravada quando a pessoa liga "Abrir o Dito quando o Windows iniciar" nas
//! Configurações (`definir_pela_pessoa`). O modo bandeja sozinho só a apaga.

use tauri::AppHandle;

/// O mesmo TaskId declarado no AppxManifest. Mudar um sem o outro faz o
/// Windows não achar a tarefa, e o início automático falha em silêncio.
#[cfg(windows)]
const TASK_ID: &str = "DitoInicioComWindows";

/// Liga ou desliga o início com o Windows. Não devolve erro de propósito:
/// quem chama é o interruptor do modo bandeja, e uma recusa do Windows não
/// pode impedir o resto de funcionar.
///
/// Roda numa thread própria porque um comando síncrono do Tauri roda na thread
/// principal, e as duas chamadas daqui bloqueiam: o registro escreve em disco,
/// e o WinRT espera uma operação assíncrona terminar. Travar a thread da
/// janela para ajustar uma preferência seria pagar caro por nada — ninguém
/// espera resposta desta função.
pub fn ajustar(app: AppHandle, ligado: bool) {
    std::thread::spawn(move || {
        if let Err(err) = aplicar(&app, ligado) {
            log::warn!("não foi possível ajustar o início com o Windows: {err}");
        }
    });
}

/// Acompanha o interruptor do modo bandeja (ver `set_background_mode`). Dentro
/// do pacote, o início com o Windows vai junto com o detector. Fora dele, só
/// vai junto para desligar: ligar é pedido da pessoa.
pub fn acompanhar_modo_bandeja(app: AppHandle, ligado: bool) {
    if ligado && !empacotado() {
        return;
    }
    ajustar(app, ligado);
}

/// Estado do interruptor das Configurações. `None` dentro do pacote, onde ele
/// não existe porque o início acompanha o detector; fora dele, se a chave
/// `Run` está gravada.
pub fn estado_da_pessoa(app: &AppHandle) -> Option<bool> {
    if empacotado() {
        return None;
    }
    use tauri_plugin_autostart::ManagerExt;
    Some(app.autolaunch().is_enabled().unwrap_or(false))
}

/// O interruptor das Configurações. Devolve o estado em que a chave ficou, para
/// a tela mostrar o que de fato aconteceu, e não o que foi pedido.
pub fn definir_pela_pessoa(app: &AppHandle, ligado: bool) -> Result<bool, String> {
    if empacotado() {
        return Err("dentro do pacote o início com o Windows acompanha o detector".into());
    }
    aplicar(app, ligado)?;
    Ok(estado_da_pessoa(app).unwrap_or(false))
}

fn aplicar(app: &AppHandle, ligado: bool) -> Result<(), String> {
    #[cfg(windows)]
    if empacotado() {
        return tarefa_do_pacote(ligado);
    }

    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    if ligado {
        autostart.enable()
    } else {
        autostart.disable()
    }
    .map_err(|e| e.to_string())
}

/// Estamos rodando de dentro de um pacote MSIX? `GetCurrentPackageFullName`
/// devolve `APPMODEL_ERROR_NO_PACKAGE` quando não; quando sim, reclama do
/// buffer vazio (`ERROR_INSUFFICIENT_BUFFER`), que é resposta suficiente — o
/// nome do pacote em si não interessa a ninguém aqui.
#[cfg(windows)]
pub fn empacotado() -> bool {
    use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

    let mut tamanho: u32 = 0;
    let erro = unsafe { GetCurrentPackageFullName(&mut tamanho, None) };
    erro != APPMODEL_ERROR_NO_PACKAGE
}

/// Fora do Windows (o build de desenvolvimento) não existe pacote.
#[cfg(not(windows))]
pub fn empacotado() -> bool {
    false
}

/// O caminho da Store. `GetAsync` acha a tarefa declarada no manifesto;
/// `RequestEnableAsync` pede para ligá-la.
///
/// O pedido pode voltar negado, e não é erro nosso: se a pessoa desligou o
/// Dito na aba Inicializar do Gerenciador de Tarefas, o Windows passa a
/// recusar para sempre — só ela pode religar por lá, e nenhuma API tem poder
/// de passar por cima disso. Por isso vira um aviso no log, não uma falha.
#[cfg(windows)]
fn tarefa_do_pacote(ligado: bool) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::ApplicationModel::{StartupTask, StartupTaskState};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    // A thread é nova (ver `ajustar`), então ainda não tem COM. Em MTA porque
    // é aqui que se pode esperar uma operação assíncrona terminar sem
    // bloquear uma fila de mensagens de janela. Um segundo `CoInitializeEx` na
    // mesma thread devolve erro e não faz mal nenhum.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let tarefa = StartupTask::GetAsync(&HSTRING::from(TASK_ID))
        .and_then(|op| op.get())
        .map_err(|e| format!("StartupTask {TASK_ID} não encontrada: {e}"))?;

    if !ligado {
        return tarefa.Disable().map_err(|e| e.to_string());
    }

    let estado = tarefa
        .RequestEnableAsync()
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?;

    if estado != StartupTaskState::Enabled && estado != StartupTaskState::EnabledByPolicy {
        log::warn!(
            "o Windows não deixou o Dito iniciar sozinho ({estado:?}); \
             a pessoa pode religar em Gerenciador de Tarefas → Aplicativos de inicialização"
        );
    }
    Ok(())
}
