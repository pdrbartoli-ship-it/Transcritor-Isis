//! Permissão de microfone de um app empacotado (MSIX).
//!
//! Fora do pacote, o Windows deixa qualquer programa abrir o microfone (o
//! bloqueio ali é global, na tela de privacidade, e o WASAPI só devolve
//! "acesso negado"). Dentro de um pacote da Store, não: o app tem identidade
//! própria, aparece sozinho em Configurações > Privacidade > Microfone e
//! precisa **pedir** o acesso. Sem esse pedido, `IAudioClient::Initialize`
//! volta com 0x80070005 e a gravação sai muda, sem nenhuma explicação para
//! quem está usando — que foi exatamente o que aconteceu no primeiro teste da
//! versão da Store.
//!
//! Este módulo faz o pedido uma vez por execução, antes de abrir o microfone,
//! e transforma a recusa numa frase que diz onde clicar.

#[cfg(windows)]
use std::sync::OnceLock;

/// Resultado guardado: o Windows não muda de ideia no meio da execução, e
/// pedir de novo a cada gravação faria a caixa de permissão piscar toda vez.
#[cfg(windows)]
static DECIDIDO: OnceLock<Result<(), String>> = OnceLock::new();

/// Garante que o microfone está liberado para este app. Devolve `Ok` também
/// quando não há nada a pedir (fora do pacote), porque lá a permissão não é
/// por app.
pub fn garantir_microfone() -> Result<(), String> {
    #[cfg(windows)]
    {
        if !crate::inicio::empacotado() {
            return Ok(());
        }
        return DECIDIDO.get_or_init(pedir_microfone).clone();
    }
    #[cfg(not(windows))]
    Ok(())
}

#[cfg(windows)]
fn pedir_microfone() -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Security::Authorization::AppCapabilityAccess::{
        AppCapability, AppCapabilityAccessStatus,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    // Chamado de uma thread de captura, recém-criada e sem COM. Um segundo
    // CoInitializeEx na mesma thread devolve erro e não faz mal nenhum.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let capacidade = AppCapability::Create(&HSTRING::from("microphone"))
        .map_err(|e| format!("não foi possível consultar a permissão de microfone: {e}"))?;

    let mut estado = capacidade.CheckAccess().map_err(|e| e.to_string())?;

    // `UserPromptRequired` é o estado de quem nunca respondeu. É o único em que
    // perguntar resolve: negado pela pessoa ou pela política do computador só
    // muda em Configurações, e insistir ali abriria uma caixa por gravação.
    if estado == AppCapabilityAccessStatus::UserPromptRequired {
        estado = capacidade
            .RequestAccessAsync()
            .and_then(|op| op.get())
            .map_err(|e| format!("falha ao pedir acesso ao microfone: {e}"))?;
    }

    match estado {
        AppCapabilityAccessStatus::Allowed => Ok(()),
        AppCapabilityAccessStatus::DeniedBySystem => Err(
            "O Windows está bloqueando o microfone para todos os aplicativos. \
             Abra Configurações > Privacidade e segurança > Microfone e ligue \
             \"Acesso ao microfone\"."
                .into(),
        ),
        _ => Err(
            "O Windows não está deixando o Dito usar o microfone. Abra \
             Configurações > Privacidade e segurança > Microfone, encontre o \
             Dito na lista e ligue o interruptor."
                .into(),
        ),
    }
}
