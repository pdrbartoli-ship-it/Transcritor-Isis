//! Quem está com o microfone aberto, segundo o próprio Windows.
//!
//! O Windows já guarda isso para a tela de privacidade do sistema: em
//! `ConsentStore\microphone` cada programa que pediu o microfone tem uma
//! subchave com `LastUsedTimeStart` e `LastUsedTimeStop`. Enquanto o programa
//! está gravando, `LastUsedTimeStop` vale 0.
//!
//! É leitura de HKCU e nada sai do computador — é o mesmo dado que a pessoa vê
//! em Configurações do Windows, em "Privacidade do microfone".
//!
//! Duas formas de subchave convivem ali: os programas instalados à moda antiga
//! ficam sob `NonPackaged`, com o caminho do executável e as barras trocadas
//! por `#`; os da Store aparecem direto, pelo nome de família do pacote (é
//! assim que o Teams novo aparece).

use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
use winreg::RegKey;

const CONSENT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
const NAO_EMPACOTADOS: &str = "NonPackaged";

/// Nomes (em minúsculas) de quem está com o microfone aberto agora. Para um
/// programa comum é o nome do executável (`zoom.exe`); para um app da Store, o
/// nome de família do pacote (`msteams_8wekyb3d8bbwe`).
pub fn em_uso() -> Vec<String> {
    let Ok(store) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(CONSENT, KEY_READ)
    else {
        // Sem a chave (Windows muito antigo, política de grupo) o detector
        // simplesmente não vê nada, em vez de derrubar a thread.
        return Vec::new();
    };

    let mut abertos = Vec::new();
    for nome in store.enum_keys().flatten() {
        let Ok(chave) = store.open_subkey_with_flags(&nome, KEY_READ) else { continue };

        if nome.eq_ignore_ascii_case(NAO_EMPACOTADOS) {
            for caminho in chave.enum_keys().flatten() {
                let Ok(sub) = chave.open_subkey_with_flags(&caminho, KEY_READ) else { continue };
                if esta_gravando(&sub) {
                    abertos.push(executavel_do_caminho(&caminho));
                }
            }
            continue;
        }

        if esta_gravando(&chave) {
            abertos.push(nome.to_lowercase());
        }
    }
    abertos
}

/// `LastUsedTimeStop == 0` é o Windows dizendo "ainda não parou". O
/// `Start > 0` descarta entradas que nunca chegaram a ser usadas.
fn esta_gravando(chave: &RegKey) -> bool {
    let parou: u64 = chave.get_value("LastUsedTimeStop").unwrap_or(1);
    let comecou: u64 = chave.get_value("LastUsedTimeStart").unwrap_or(0);
    parou == 0 && comecou > 0
}

/// `C:#Program Files#Zoom#bin#Zoom.exe` vira `zoom.exe`.
fn executavel_do_caminho(chave: &str) -> String {
    chave
        .rsplit(['#', '\\', '/'])
        .next()
        .unwrap_or(chave)
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::executavel_do_caminho;

    #[test]
    fn tira_o_nome_do_executavel_do_caminho_da_chave() {
        assert_eq!(
            executavel_do_caminho(r"C:#Program Files#Zoom#bin#Zoom.exe"),
            "zoom.exe"
        );
        assert_eq!(executavel_do_caminho("chrome.exe"), "chrome.exe");
    }
}
