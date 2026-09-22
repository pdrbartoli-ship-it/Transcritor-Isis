//! A regra da detecção de reunião, sem Windows e sem Tauri.
//!
//! Tudo o que decide se uma reunião começou mora aqui, numa máquina de estados
//! que só recebe "quem está com o microfone agora" e devolve eventos. O motivo
//! é prático: o Codespace onde este código é escrito não roda Windows, então a
//! única parte que dá para provar com teste automático é a que não fala com o
//! sistema. `registro.rs` e `janelas.rs` ficam com a conversa com o Windows, e
//! são finos de propósito.

use serde::Serialize;

/// Intervalo de leitura do detector.
pub const POLL_MS: u64 = 2000;
/// Tempo com o microfone em uso antes de contar como reunião. A pré-sala do
/// Zoom e do Meet já segura o microfone, e contar isso como início é
/// desejável: a pessoa está entrando.
pub const START_DEBOUNCE_S: u64 = 8;
/// Tempo com o microfone livre antes de contar como fim.
pub const END_DEBOUNCE_S: u64 = 20;
/// Janela de tempo para um navegador mostrar um título de reunião. Depois
/// disso o uso do microfone é de outra coisa (ditado, WhatsApp Web, Discord).
pub const TITULO_JANELA_S: u64 = 30;

/// Programas que são reunião por si sós. A lista é uma constante justamente
/// para ser fácil de estender (Webex, Slack, Discord) sem tocar na regra.
/// Nomes sempre em minúsculas — quem preenche normaliza antes.
const APPS: &[(&str, &str)] = &[
    ("zoom.exe", "zoom"),
    ("ms-teams.exe", "teams"),
    ("msteams.exe", "teams"),
    ("teams.exe", "teams"),
    // O Teams novo é um app empacotado: no registro ele aparece pelo nome de
    // família do pacote, não por um caminho de executável.
    ("msteams_8wekyb3d8bbwe", "teams"),
];

const NAVEGADORES: &[&str] = &["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"];

/// O próprio Dito usa o microfone quando grava. Sem isto, gravar uma reunião
/// faria o detector anunciar uma reunião nova.
const IGNORADOS: &[&str] = &["dito.exe", "app.exe", "albiecloud.57831c11ea014"];

/// Quem está com o microfone aberto neste ciclo, já normalizado por quem leu
/// o sistema. `titulos` são os títulos das janelas visíveis desse processo —
/// vazio para um app sem janela ou quando não foi possível ler.
#[derive(Debug, Clone, Default)]
pub struct Uso {
    pub exe: String,
    pub em_uso: bool,
    pub titulos: Vec<String>,
}

impl Uso {
    /// Só os testes montam um `Uso` na mão: em produção quem preenche é o
    /// `mod.rs`, a partir do registro e dos títulos de janela.
    #[cfg(test)]
    pub fn novo(exe: &str, titulos: &[&str]) -> Self {
        Uso {
            exe: exe.to_lowercase(),
            em_uso: true,
            titulos: titulos.iter().map(|t| t.to_string()).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum Evento {
    /// `id` cresce a cada reunião, e é o que impede o JS de sugerir duas vezes
    /// a mesma.
    Started {
        id: u64,
        app: String,
        titulo: Option<String>,
    },
    Ended {
        id: u64,
    },
}

/// Reunião em curso: já foi anunciada e fica presa até o microfone liberar.
#[derive(Debug)]
struct EmCurso {
    id: u64,
    chave: String,
    ticks_livre: u64,
}

/// Uso de microfone ainda em observação.
#[derive(Debug)]
struct Candidato {
    chave: String,
    ticks: u64,
    /// Qual app é, quando já dá para saber. Num navegador só fica definido
    /// quando um título de reunião aparece.
    app: Option<String>,
    titulo: Option<String>,
    /// Navegador que passou da janela de título sem mostrar reunião nenhuma:
    /// não se reavalia mais até o microfone fechar, senão uma aba de reunião
    /// aberta duas horas depois ressuscitaria este mesmo uso.
    descartado: bool,
}

pub struct Maquina {
    proximo_id: u64,
    em_curso: Option<EmCurso>,
    candidato: Option<Candidato>,
    ticks_por_inicio: u64,
    ticks_por_fim: u64,
    ticks_de_titulo: u64,
}

impl Default for Maquina {
    fn default() -> Self {
        Maquina::nova(POLL_MS)
    }
}

impl Maquina {
    pub fn nova(poll_ms: u64) -> Self {
        let ticks = |segundos: u64| ((segundos * 1000) as f64 / poll_ms as f64).ceil() as u64;
        Maquina {
            proximo_id: 1,
            em_curso: None,
            candidato: None,
            ticks_por_inicio: ticks(START_DEBOUNCE_S),
            ticks_por_fim: ticks(END_DEBOUNCE_S),
            ticks_de_titulo: ticks(TITULO_JANELA_S),
        }
    }

    /// Um ciclo do detector. Recebe quem está com o microfone e devolve o que
    /// mudou — normalmente nada.
    pub fn avancar(&mut self, usos: &[Uso]) -> Vec<Evento> {
        let mut eventos = Vec::new();
        let relevantes: Vec<&Uso> = usos
            .iter()
            .filter(|u| u.em_uso && !ignorado(&u.exe) && classificar(&u.exe).is_some())
            .collect();

        // Uma reunião em curso só termina quando o microfone DELA fecha. O que
        // qualquer outro programa faça no meio não interessa.
        if let Some(curso) = self.em_curso.as_mut() {
            let ainda = relevantes.iter().any(|u| u.exe == curso.chave);
            if ainda {
                curso.ticks_livre = 0;
            } else {
                curso.ticks_livre += 1;
                if curso.ticks_livre >= self.ticks_por_fim {
                    eventos.push(Evento::Ended { id: curso.id });
                    self.em_curso = None;
                    self.candidato = None;
                }
            }
            return eventos;
        }

        // Fora de reunião, observa o primeiro candidato: apps dedicados antes
        // de navegadores, porque num Teams aberto no app e no navegador ao
        // mesmo tempo o app é a resposta certa.
        let escolhido = relevantes
            .iter()
            .find(|u| matches!(classificar(&u.exe), Some(Tipo::App(_))))
            .or_else(|| relevantes.first());

        let Some(uso) = escolhido else {
            self.candidato = None;
            return eventos;
        };

        let novo = match &self.candidato {
            Some(c) if c.chave == uso.exe => false,
            _ => true,
        };
        if novo {
            self.candidato = Some(Candidato {
                chave: uso.exe.clone(),
                ticks: 0,
                app: match classificar(&uso.exe) {
                    Some(Tipo::App(nome)) => Some(nome.to_string()),
                    _ => None,
                },
                titulo: None,
                descartado: false,
            });
        }

        let ticks_de_titulo = self.ticks_de_titulo;
        let ticks_por_inicio = self.ticks_por_inicio;
        // O empréstimo do candidato termina aqui dentro: logo abaixo é a
        // própria máquina que muda de estado.
        let pronto = {
            let candidato = self.candidato.as_mut().expect("candidato recém-criado");
            candidato.ticks += 1;

            // Navegador: o título só vale logo depois de o microfone abrir,
            // porque a janela do Chrome mostra o título da aba ATIVA — e é
            // nela que a pessoa acabou de clicar em "Participar". Minutos
            // depois, o mesmo título diria respeito a outra aba qualquer.
            if candidato.app.is_none() && !candidato.descartado {
                if let Some((app, titulo)) = titulo_de_reuniao(&uso.titulos) {
                    candidato.app = Some(app.to_string());
                    candidato.titulo = Some(titulo);
                } else if candidato.ticks > ticks_de_titulo {
                    candidato.descartado = true;
                }
            }

            match (&candidato.app, candidato.ticks >= ticks_por_inicio) {
                (Some(app), true) => Some((
                    app.clone(),
                    candidato.titulo.clone(),
                    candidato.chave.clone(),
                )),
                _ => None,
            }
        };

        if let Some((app, titulo, chave)) = pronto {
            let id = self.proximo_id;
            self.proximo_id += 1;
            self.em_curso = Some(EmCurso { id, chave, ticks_livre: 0 });
            self.candidato = None;
            eventos.push(Evento::Started { id, app, titulo });
        }

        eventos
    }

    /// Esquecer tudo ao desligar o detector: religado, ele não pode acordar no
    /// meio de uma reunião que ninguém está acompanhando.
    pub fn limpar(&mut self) {
        self.em_curso = None;
        self.candidato = None;
    }
}

enum Tipo {
    App(&'static str),
    Navegador,
}

fn ignorado(exe: &str) -> bool {
    IGNORADOS.iter().any(|i| exe == *i || exe.starts_with(i))
}

fn classificar(exe: &str) -> Option<Tipo> {
    if ignorado(exe) {
        return None;
    }
    if let Some((_, app)) = APPS.iter().find(|(nome, _)| exe == *nome) {
        return Some(Tipo::App(app));
    }
    if NAVEGADORES.contains(&exe) {
        return Some(Tipo::Navegador);
    }
    None
}

/// Um título de janela de navegador que denuncia uma reunião. Sem um destes, o
/// microfone aberto num navegador é outra coisa (áudio do WhatsApp Web, ditado
/// por voz) e não vira convite nenhum.
fn titulo_de_reuniao(titulos: &[String]) -> Option<(&'static str, String)> {
    for titulo in titulos {
        let t = titulo.to_lowercase();
        let app = if t.contains("meet.google.com") || t.contains("meet - ") || t == "meet" {
            Some("meet")
        } else if t.contains("microsoft teams") {
            Some("teams")
        } else if t.contains("zoom.us") || t.contains("zoom meeting") || t.contains("reunião do zoom") {
            Some("zoom")
        } else {
            None
        };
        if let Some(app) = app {
            return Some((app, titulo.clone()));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const POLL: u64 = 2000; // 2s por ciclo: 4 ciclos para os 8s de início

    fn rodar(m: &mut Maquina, usos: &[Uso], ciclos: usize) -> Vec<Evento> {
        let mut todos = Vec::new();
        for _ in 0..ciclos {
            todos.extend(m.avancar(usos));
        }
        todos
    }

    #[test]
    fn zoom_vira_reuniao_depois_do_debounce() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("Zoom.exe", &[])];
        assert!(rodar(&mut m, &usos, 3).is_empty(), "8s ainda não passaram");
        let eventos = rodar(&mut m, &usos, 1);
        assert_eq!(
            eventos,
            vec![Evento::Started { id: 1, app: "zoom".into(), titulo: None }]
        );
        // E não repete enquanto a reunião durar.
        assert!(rodar(&mut m, &usos, 20).is_empty());
    }

    #[test]
    fn microfone_que_pisca_nao_vira_reuniao() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("Zoom.exe", &[])];
        assert!(rodar(&mut m, &usos, 2).is_empty());
        assert!(rodar(&mut m, &[], 1).is_empty());
        assert!(rodar(&mut m, &usos, 3).is_empty(), "a contagem recomeça do zero");
    }

    #[test]
    fn navegador_sem_titulo_de_reuniao_e_ignorado() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("chrome.exe", &["WhatsApp"])];
        assert!(rodar(&mut m, &usos, 40).is_empty());
    }

    #[test]
    fn navegador_com_titulo_de_meet_vira_reuniao() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("chrome.exe", &["Meet - abc-defg-hij"])];
        let eventos = rodar(&mut m, &usos, 4);
        assert_eq!(
            eventos,
            vec![Evento::Started {
                id: 1,
                app: "meet".into(),
                titulo: Some("Meet - abc-defg-hij".into())
            }]
        );
    }

    #[test]
    fn titulo_que_chega_depois_da_janela_nao_conta() {
        let mut m = Maquina::nova(POLL);
        let sem = [Uso::novo("chrome.exe", &["WhatsApp"])];
        assert!(rodar(&mut m, &sem, 20).is_empty());
        let com = [Uso::novo("chrome.exe", &["Meet - abc-defg-hij"])];
        assert!(
            rodar(&mut m, &com, 10).is_empty(),
            "o microfone abriu para outra coisa; a aba de reunião veio depois"
        );
    }

    #[test]
    fn o_proprio_dito_nunca_vira_reuniao() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("Dito.exe", &["Dito"])];
        assert!(rodar(&mut m, &usos, 40).is_empty());
    }

    #[test]
    fn fim_depois_do_debounce_de_saida() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("ms-teams.exe", &[])];
        assert_eq!(rodar(&mut m, &usos, 4).len(), 1);
        // 20s de microfone livre = 10 ciclos; antes disso, nada.
        assert!(rodar(&mut m, &[], 9).is_empty());
        assert_eq!(rodar(&mut m, &[], 1), vec![Evento::Ended { id: 1 }]);
    }

    #[test]
    fn microfone_que_some_por_um_ciclo_nao_encerra() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("Zoom.exe", &[])];
        assert_eq!(rodar(&mut m, &usos, 4).len(), 1);
        assert!(rodar(&mut m, &[], 5).is_empty());
        assert!(rodar(&mut m, &usos, 1).is_empty());
        assert!(rodar(&mut m, &[], 9).is_empty(), "a contagem de fim recomeçou");
    }

    #[test]
    fn duas_reunioes_seguidas_tem_ids_diferentes() {
        let mut m = Maquina::nova(POLL);
        let usos = [Uso::novo("Zoom.exe", &[])];
        assert_eq!(rodar(&mut m, &usos, 4).len(), 1);
        assert_eq!(rodar(&mut m, &[], 10), vec![Evento::Ended { id: 1 }]);
        let eventos = rodar(&mut m, &usos, 4);
        assert_eq!(
            eventos,
            vec![Evento::Started { id: 2, app: "zoom".into(), titulo: None }]
        );
    }

    #[test]
    fn app_dedicado_tem_preferencia_sobre_navegador() {
        let mut m = Maquina::nova(POLL);
        let usos = [
            Uso::novo("chrome.exe", &["Meet - abc-defg-hij"]),
            Uso::novo("Zoom.exe", &[]),
        ];
        let eventos = rodar(&mut m, &usos, 4);
        assert_eq!(
            eventos,
            vec![Evento::Started { id: 1, app: "zoom".into(), titulo: None }]
        );
    }

    #[test]
    fn gravar_o_dito_durante_a_reuniao_nao_encerra_nem_reinicia() {
        let mut m = Maquina::nova(POLL);
        assert_eq!(rodar(&mut m, &[Uso::novo("Zoom.exe", &[])], 4).len(), 1);
        let com_dito = [Uso::novo("Zoom.exe", &[]), Uso::novo("Dito.exe", &[])];
        assert!(rodar(&mut m, &com_dito, 30).is_empty());
    }
}
