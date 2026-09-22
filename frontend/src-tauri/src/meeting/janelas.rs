//! Títulos das janelas visíveis, por executável.
//!
//! O microfone aberto num navegador não diz nada sozinho: pode ser um áudio do
//! WhatsApp Web, um ditado por voz ou uma reunião. Quem separa os casos é o
//! título da janela, e é só para isso que este módulo existe.
//!
//! Nada daqui sai do computador: os títulos são usados para classificar e
//! descartados no mesmo ciclo (ver mod.rs — o título nunca entra na telemetria).

use std::collections::HashMap;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

// BOOL mora em `windows::core`, e não em `Win32::Foundation`: nas versões novas
// da crate os tipos primitivos foram para o núcleo, e só as constantes (TRUE)
// ficaram onde estavam.
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, MAX_PATH, TRUE};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

/// Nome do executável (minúsculo) para os títulos das janelas visíveis dele.
pub fn titulos_por_executavel() -> HashMap<String, Vec<String>> {
    let mut mapa: HashMap<String, Vec<String>> = HashMap::new();
    let ponteiro = &mut mapa as *mut HashMap<String, Vec<String>>;
    unsafe {
        // Uma falha aqui (nenhuma janela, sessão sem desktop) deixa o mapa
        // vazio, e o detector segue tratando os navegadores como "sem título".
        let _ = EnumWindows(Some(coletar), LPARAM(ponteiro as isize));
    }
    mapa
}

unsafe extern "system" fn coletar(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let mapa = &mut *(lparam.0 as *mut HashMap<String, Vec<String>>);

    if !IsWindowVisible(hwnd).as_bool() {
        return TRUE;
    }
    let titulo = texto_da_janela(hwnd);
    if titulo.is_empty() {
        return TRUE;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return TRUE;
    }
    if let Some(exe) = executavel_do_processo(pid) {
        mapa.entry(exe).or_default().push(titulo);
    }
    TRUE
}

unsafe fn texto_da_janela(hwnd: HWND) -> String {
    let tamanho = GetWindowTextLengthW(hwnd);
    if tamanho <= 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; tamanho as usize + 1];
    let escritos = GetWindowTextW(hwnd, &mut buffer);
    if escritos <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buffer[..escritos as usize])
}

/// `PROCESS_QUERY_LIMITED_INFORMATION` é o direito mínimo que serve aqui: dá
/// o caminho do executável sem pedir acesso ao processo em si, e por isso
/// funciona também com processos de outro nível de integridade.
fn executavel_do_processo(pid: u32) -> Option<String> {
    unsafe {
        let processo = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; MAX_PATH as usize];
        let mut tamanho = buffer.len() as u32;
        let leitura = QueryFullProcessImageNameW(
            processo,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut tamanho,
        );
        let _ = CloseHandle(processo);
        leitura.ok()?;

        let caminho = OsString::from_wide(&buffer[..tamanho as usize])
            .to_string_lossy()
            .to_string();
        Some(
            caminho
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or(&caminho)
                .to_lowercase(),
        )
    }
}
