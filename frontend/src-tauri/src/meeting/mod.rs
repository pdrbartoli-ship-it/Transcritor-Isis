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
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use estado::{normalizar_exe, Evento, Maquina, Uso, POLL_MS};

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

/// Depois de um aviso do registro, o detector espera um instante antes de ler:
/// abrir o microfone mexe em mais de um valor seguido, e ler entre um e outro
/// veria o estado pela metade.
#[cfg(windows)]
const JUNTAR_AVISOS_MS: u64 = 100;

fn rodar(app: AppHandle, ligado: Arc<AtomicBool>) {
    let mut maquina = Maquina::default();
    let mut estava_ligado = true;
    let relogio = Instant::now();
    let espera = Espera::nova();

    loop {
        espera.proxima();

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

        let agora = relogio.elapsed().as_millis() as u64;
        let eventos = maquina.avancar(agora, &ler_usos());
        // Uma linha por decisão no arquivo de log do app
        // (%LOCALAPPDATA%\com.dito.app\logs): quem abriu o microfone, se o
        // título casou, quando a reunião começou e terminou. Nunca o título.
        for nota in maquina.tirar_notas() {
            log::info!("detector de reunião: {nota}");
        }

        for evento in eventos {
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

/// Até o próximo passo do detector: o aviso do Windows de que o microfone
/// mudou, ou a leitura de reserva, o que vier primeiro. Antes era sempre uma
/// espera fixa de 2 s, e o aviso saía até 2 s mais tarde do que podia.
#[cfg(windows)]
struct Espera(Option<registro::Vigia>);

#[cfg(windows)]
impl Espera {
    fn nova() -> Self {
        let vigia = registro::Vigia::novo();
        if vigia.is_none() {
            log::warn!("detector de reunião: sem aviso do registro, só a leitura a cada {POLL_MS} ms");
        }
        Espera(vigia)
    }

    fn proxima(&self) {
        match &self.0 {
            Some(vigia) => {
                if vigia.esperar(POLL_MS as u32) {
                    thread::sleep(Duration::from_millis(JUNTAR_AVISOS_MS));
                }
            }
            None => thread::sleep(Duration::from_millis(POLL_MS)),
        }
    }
}

#[cfg(not(windows))]
struct Espera;

#[cfg(not(windows))]
impl Espera {
    fn nova() -> Self {
        Espera
    }

    fn proxima(&self) {
        thread::sleep(Duration::from_millis(POLL_MS));
    }
}

#[cfg(windows)]
fn ler_usos() -> Vec<Uso> {
    let abertos = registro::em_uso();
    if abertos.is_empty() {
        return Vec::new();
    }
    // Os títulos só são lidos quando há algum microfone aberto: varrer todas as
    // janelas a cada leitura sem necessidade seria pagar caro por nada.
    let titulos = janelas::titulos_por_executavel();
    abertos
        .into_iter()
        .map(|nome| {
            let exe = normalizar_exe(&nome);
            Uso {
                titulos: titulos.get(&exe).cloned().unwrap_or_default(),
                exe,
                em_uso: true,
            }
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
