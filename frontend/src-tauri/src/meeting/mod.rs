//! Detector de reunião: percebe que um Zoom, Teams ou Meet abriu o microfone e
//! avisa o JS, que decide se vale interromper a pessoa.
//!
//! A divisão é proposital. `estado.rs` tem toda a regra e nenhuma chamada ao
//! sistema (é o que os testes cobrem); `registro.rs` e `janelas.rs` leem o
//! Windows e mais nada. Fora do Windows o detector existe, mas nunca vê nada —
//! assim o resto do app compila em qualquer lugar.
//!
//! Privacidade: só saem daqui o nome do app e um id. O título da reunião vai
//! junto no evento para uma etapa futura (nomear a conversa), mas nunca entra
//! em telemetria, e nada disso sai do computador.

pub mod estado;
#[cfg(windows)]
mod janelas;
#[cfg(windows)]
mod registro;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use estado::{Evento, Maquina, Uso, POLL_MS};

#[derive(Serialize, Clone)]
struct InicioDeReuniao {
    id: u64,
    app: String,
    titulo: Option<String>,
}

#[derive(Serialize, Clone)]
struct FimDeReuniao {
    id: u64,
}

/// O detector nasce desligado e só liga quando o JS pede (a preferência vive no
/// lado de lá, junto com tema e idioma). A thread é criada na primeira vez que
/// alguém liga e fica viva até o app fechar: desligada ela só confere um
/// booleano a cada ciclo, e manter uma thread parada custa menos do que criar e
/// derrubar thread a cada vez que a pessoa mexe no interruptor.
#[derive(Default)]
pub struct Detector {
    ligado: Arc<AtomicBool>,
    thread: Mutex<bool>,
}

impl Detector {
    pub fn definir(&self, app: &AppHandle, ligado: bool) {
        self.ligado.store(ligado, Ordering::SeqCst);
        if !ligado {
            return;
        }
        let mut criada = match self.thread.lock() {
            Ok(guard) => guard,
            Err(envenenado) => envenenado.into_inner(),
        };
        if *criada {
            return;
        }
        *criada = true;

        let ligado = self.ligado.clone();
        let app = app.clone();
        let _ = thread::Builder::new()
            .name("meeting-detector".into())
            .spawn(move || rodar(app, ligado));
    }
}

fn rodar(app: AppHandle, ligado: Arc<AtomicBool>) {
    let mut maquina = Maquina::nova(POLL_MS);
    let mut estava_ligado = true;

    loop {
        thread::sleep(Duration::from_millis(POLL_MS));

        if !ligado.load(Ordering::SeqCst) {
            // Religado depois, o detector não pode acordar no meio de uma
            // reunião que ninguém acompanhou.
            if estava_ligado {
                maquina.limpar();
                estava_ligado = false;
            }
            continue;
        }
        estava_ligado = true;

        for evento in maquina.avancar(&ler_usos()) {
            match evento {
                Evento::Started { id, app: qual, titulo } => {
                    let _ = app.emit("meeting-started", InicioDeReuniao { id, app: qual, titulo });
                }
                Evento::Ended { id } => {
                    // A principal fecha o convite que ainda estiver na tela
                    // (ver useDeteccaoReuniao): quem sai da chamada antes de
                    // responder não precisa mais da pergunta.
                    let _ = app.emit("meeting-ended", FimDeReuniao { id });
                }
            }
        }
    }
}

#[cfg(windows)]
fn ler_usos() -> Vec<Uso> {
    let abertos = registro::em_uso();
    if abertos.is_empty() {
        return Vec::new();
    }
    // Os títulos só são lidos quando há algum microfone aberto: varrer todas as
    // janelas a cada dois segundos sem necessidade seria pagar caro por nada.
    let titulos = janelas::titulos_por_executavel();
    abertos
        .into_iter()
        .map(|exe| Uso {
            titulos: titulos.get(&exe).cloned().unwrap_or_default(),
            exe,
            em_uso: true,
        })
        .collect()
}

#[cfg(not(windows))]
fn ler_usos() -> Vec<Uso> {
    Vec::new()
}

/// O site novo chega ao app antes do instalador novo (a janela abre a página
/// publicada). Sem isto, a opção apareceria nas Configurações de quem ainda tem
/// um executável sem detector, e não faria nada.
pub const fn disponivel() -> bool {
    cfg!(windows)
}
