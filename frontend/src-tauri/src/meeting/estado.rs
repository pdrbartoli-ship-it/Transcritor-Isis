//! A regra da detecção de reunião, sem Windows e sem Tauri.
//!
//! Tudo o que decide se uma reunião começou mora aqui, numa máquina de estados
//! que só recebe "quem está com o microfone agora" e devolve eventos. O motivo
//! é prático: o Codespace onde este código é escrito não roda Windows, então a
//! única parte que dá para provar com teste automático é a que não fala com o
//! sistema. `registro.rs` e `janelas.rs` ficam com a conversa com o Windows, e
//! são finos de propósito.
//!
//! A máquina conta tempo, e não ciclos. O detector acorda quando o Windows avisa
//! que o registro do microfone mudou (ver mod.rs), e não mais a cada dois
//! segundos certinhos: com intervalos irregulares, só o relógio diz quanto tempo
//! um microfone ficou aberto.

use serde::Serialize;

/// De quanto em quanto tempo o detector confere o microfone quando o Windows
/// não avisou nada. O aviso de mudança do registro é o caminho normal; esta
/// leitura fica de reserva, e é ela que vê as esperas abaixo vencerem.
pub const POLL_MS: u64 = 1000;
/// Tempo com o microfone em uso antes de contar como reunião. Eram 8 s, para
/// filtrar o microfone que "pisca"; em Teams, Zoom e navegador com título de
/// reunião isso é raro, e 2 s ainda filtram. O aviso sai uns 3 s depois de o
/// microfone abrir, como no Wispr Flow.
pub const START_DEBOUNCE_MS: u64 = 2_000;
/// Tempo com o microfone livre antes de contar como fim.
pub const END_DEBOUNCE_MS: u64 = 20_000;
/// Navegador com o microfone aberto por este tempo sem título de reunião à
/// vista vira um aviso genérico ("Chamada no Chrome"). Pega o Meet numa aba de
/// trás; áudio de WhatsApp e ditado raramente passam de um minuto seguido, e o
/// "Agora não" resolve o resto.
pub const NAVEGADOR_SEM_TITULO_MS: u64 = 60_000;

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

/// Navegadores e o nome que vai no aviso genérico. O nome é o que o site
/// mostra ("Chamada no Chrome"), então só muda junto com `lib/reuniao.js`.
const NAVEGADORES: &[(&str, &str)] = &[
    ("chrome.exe", "chrome"),
    ("msedge.exe", "edge"),
    ("firefox.exe", "firefox"),
    ("brave.exe", "brave"),
    ("opera.exe", "opera"),
    ("vivaldi.exe", "vivaldi"),
    ("arc.exe", "arc"),
];

/// Navegadores que vêm da Store aparecem no registro pelo nome de família do
/// pacote, e os títulos das janelas saem pelo nome do executável. Sem esta
/// tradução, o Arc nunca teria título nenhum.
const PACOTES: &[(&str, &str)] = &[("thebrowsercompany.arc_", "arc.exe")];

/// O próprio Dito usa o microfone quando grava. Sem isto, gravar uma reunião
/// faria o detector anunciar uma reunião nova.
const IGNORADOS: &[&str] = &["dito.exe", "app.exe", "albiecloud.57831c11ea014"];

/// O nome pelo qual a regra conhece quem está no registro: minúsculo, e com os
/// pacotes da Store conhecidos trocados pelo executável deles.
pub fn normalizar_exe(nome: &str) -> String {
    let minusculo = nome.to_lowercase();
    PACOTES
        .iter()
        .find(|(prefixo, _)| minusculo.starts_with(prefixo))
        .map(|(_, exe)| exe.to_string())
        .unwrap_or(minusculo)
}

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
            exe: normalizar_exe(exe),
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
    /// Desde quando o microfone DELA está livre. Some assim que ele volta.
    livre_desde: Option<u64>,
}

/// Uso de microfone ainda em observação.
#[derive(Debug)]
struct Candidato {
    chave: String,
    /// Quando o microfone abriu. Num navegador, o título de reunião pode
    /// aparecer muito depois disto, e aí o aviso sai na hora: o microfone já
    /// está aberto há tempo de sobra.
    desde: u64,
    /// Qual app é, quando já dá para saber. Num navegador só fica definido
    /// quando um título de reunião aparece, ou quando o minuto sem título passa.
    app: Option<String>,
    titulo: Option<String>,
}

#[derive(Default)]
pub struct Maquina {
    proximo_id: u64,
    em_curso: Option<EmCurso>,
    candidato: Option<Candidato>,
    /// Quem estava com o microfone na última leitura, para o log só ganhar uma
    /// linha quando isso muda.
    microfone: Vec<String>,
    /// O que aconteceu, em frases curtas, para o arquivo de log. Nunca leva o
    /// título da janela: só nomes de programa, tempos e ids.
    notas: Vec<String>,
}

impl Maquina {
    /// Um passo do detector. `agora` é o relógio em milissegundos (qualquer
    /// origem, desde que só cresça). Recebe quem está com o microfone e devolve
    /// o que mudou — normalmente nada.
    pub fn avancar(&mut self, agora: u64, usos: &[Uso]) -> Vec<Evento> {
        let mut eventos = Vec::new();
        self.anotar_microfone(usos);

        let relevantes: Vec<&Uso> = usos
            .iter()
            .filter(|u| u.em_uso && classificar(&u.exe).is_some())
            .collect();

        // Enquanto o microfone da reunião em curso está aberto, o que qualquer
        // outro programa faça não interessa: é a mesma reunião. Livre, ela
        // espera os 20 s de fim, mas não prende mais o detector: outro programa
        // de reunião pode começar a contar no mesmo instante (ver abaixo).
        if let Some(curso) = self.em_curso.as_mut() {
            if relevantes.iter().any(|u| u.exe == curso.chave) {
                curso.livre_desde = None;
                self.candidato = None;
                return eventos;
            }
            let livre_desde = *curso.livre_desde.get_or_insert(agora);
            if agora.saturating_sub(livre_desde) >= END_DEBOUNCE_MS {
                let id = curso.id;
                self.em_curso = None;
                eventos.push(Evento::Ended { id });
                self.notas.push(format!("reunião {id} terminou"));
            }
        }

        // Observa o primeiro candidato: apps dedicados antes de navegadores,
        // porque num Teams aberto no app e no navegador ao mesmo tempo o app é
        // a resposta certa.
        let escolhido = relevantes
            .iter()
            .find(|u| matches!(classificar(&u.exe), Some(Tipo::App(_))))
            .or_else(|| relevantes.first());

        let Some(uso) = escolhido else {
            self.candidato = None;
            return eventos;
        };

        if !matches!(&self.candidato, Some(c) if c.chave == uso.exe) {
            self.candidato = Some(Candidato {
                chave: uso.exe.clone(),
                desde: agora,
                app: match classificar(&uso.exe) {
                    Some(Tipo::App(nome)) => Some(nome.to_string()),
                    _ => None,
                },
                titulo: None,
            });
        }

        // O empréstimo do candidato termina aqui dentro: logo abaixo é a
        // própria máquina que muda de estado.
        let pronto = {
            let candidato = self.candidato.as_mut().expect("candidato recém-criado");
            let aberto_ha = agora.saturating_sub(candidato.desde);

            // Navegador: o título é conferido a cada passo enquanto o microfone
            // estiver aberto. Antes só valia nos primeiros 30 s, e a reunião em
            // que a pessoa entrava com o microfone já aberto passava batida.
            if let (Some(Tipo::Navegador(nome)), None) = (classificar(&uso.exe), &candidato.app) {
                if let Some((app, titulo)) = titulo_de_reuniao(&uso.titulos) {
                    candidato.app = Some(app.to_string());
                    candidato.titulo = Some(titulo);
                    self.notas.push(format!(
                        "{}: título de reunião do {app}, microfone aberto há {}",
                        uso.exe,
                        segundos(aberto_ha)
                    ));
                } else if aberto_ha >= NAVEGADOR_SEM_TITULO_MS {
                    candidato.app = Some(nome.to_string());
                    self.notas.push(format!(
                        "{}: microfone aberto há {} sem título de reunião, aviso genérico",
                        uso.exe,
                        segundos(aberto_ha)
                    ));
                }
            }

            match (&candidato.app, aberto_ha >= START_DEBOUNCE_MS) {
                (Some(app), true) => Some((
                    app.clone(),
                    candidato.titulo.clone(),
                    candidato.chave.clone(),
                    aberto_ha,
                )),
                _ => None,
            }
        };

        if let Some((app, titulo, chave, aberto_ha)) = pronto {
            // A reunião anterior, com o microfone já livre, termina no instante
            // em que outra começa. Antes ela prendia o detector por 20 s, e a
            // segunda reunião só era vista depois disso.
            if let Some(antiga) = self.em_curso.take() {
                eventos.push(Evento::Ended { id: antiga.id });
                self.notas.push(format!(
                    "reunião {} terminou: {chave} abriu o microfone",
                    antiga.id
                ));
            }
            self.proximo_id += 1;
            let id = self.proximo_id;
            self.notas.push(format!(
                "reunião {id} começou ({app}), {} depois de o microfone abrir",
                segundos(aberto_ha)
            ));
            self.em_curso = Some(EmCurso { id, chave, livre_desde: None });
            self.candidato = None;
            eventos.push(Evento::Started { id, app, titulo });
        }

        eventos
    }

    /// As linhas de log desde a última chamada.
    pub fn tirar_notas(&mut self) -> Vec<String> {
        std::mem::take(&mut self.notas)
    }

    /// Esquecer tudo ao desligar o detector: religado, ele não pode acordar no
    /// meio de uma reunião que ninguém está acompanhando.
    pub fn limpar(&mut self) {
        self.em_curso = None;
        self.candidato = None;
        self.microfone.clear();
    }

    /// Uma linha de log quando muda quem está com o microfone. Entram todos os
    /// programas, e não só os de reunião: é por aqui que se descobre o nome de
    /// um app que ainda não está na lista (Webex, Slack, Discord).
    fn anotar_microfone(&mut self, usos: &[Uso]) {
        let mut agora: Vec<String> = usos
            .iter()
            .filter(|u| u.em_uso && !ignorado(&u.exe))
            .map(|u| u.exe.clone())
            .collect();
        agora.sort();
        agora.dedup();
        if agora == self.microfone {
            return;
        }
        self.notas.push(if agora.is_empty() {
            "microfone livre".to_string()
        } else {
            format!("microfone com: {}", agora.join(", "))
        });
        self.microfone = agora;
    }
}

fn segundos(ms: u64) -> String {
    format!("{:.1} s", ms as f64 / 1000.0)
}

enum Tipo {
    App(&'static str),
    Navegador(&'static str),
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
    if let Some((_, nome)) = NAVEGADORES.iter().find(|(nav, _)| exe == *nav) {
        return Some(Tipo::Navegador(nome));
    }
    None
}

/// Um título de janela de navegador que denuncia uma reunião. Sem um destes,
/// o microfone aberto num navegador é outra coisa (áudio do WhatsApp Web,
/// ditado por voz), até o minuto do aviso genérico passar.
fn titulo_de_reuniao(titulos: &[String]) -> Option<(&'static str, String)> {
    titulos
        .iter()
        .find_map(|titulo| app_do_titulo(&titulo.to_lowercase()).map(|app| (app, titulo.clone())))
}

fn app_do_titulo(t: &str) -> Option<&'static str> {
    // Meet: "Meet - xxx" é a tela de entrada; "Meet: xxx-xxxx-xxx" é o título
    // de dentro da reunião, que a regra antiga (só com hífen) não pegava.
    if t.contains("meet.google.com")
        || t.contains("meet - ")
        || t.contains("meet: ")
        || t.contains("google meet")
        || t == "meet"
        || tem_codigo_de_sala(t)
    {
        return Some("meet");
    }
    // Teams na web: "Ingresso na reunião | Reunião do Microsoft Teams |
    // Microsoft Teams", do diagnóstico de 25/09.
    if t.contains("microsoft teams") {
        return Some("teams");
    }
    if t.contains("zoom.us") || t.contains("zoom meeting") || t.contains("reunião do zoom") {
        return Some("zoom");
    }
    None
}

/// O código de uma sala do Meet (`bch-nxpf-jmm`: três letras, quatro, três),
/// solto no título. Sem regex de propósito: é um formato fixo, e uma crate a
/// mais no executável por uma regra só não se paga.
fn tem_codigo_de_sala(t: &str) -> bool {
    const FORMATO: &[u8] = b"aaa-aaaa-aaa";
    let b = t.as_bytes();
    if b.len() < FORMATO.len() {
        return false;
    }
    let solto = |c: Option<&u8>| !c.is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'-');
    (0..=b.len() - FORMATO.len()).any(|i| {
        let trecho = &b[i..i + FORMATO.len()];
        let casa = trecho.iter().zip(FORMATO).all(|(c, f)| match f {
            b'-' => *c == b'-',
            _ => c.is_ascii_lowercase(),
        });
        casa && solto(i.checked_sub(1).and_then(|j| b.get(j))) && solto(b.get(i + FORMATO.len()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Um detector com relógio: `agora` é uma leitura disparada pelo aviso do
    /// registro no instante atual; `por` deixa o tempo correr com as leituras
    /// de reserva, uma por segundo.
    #[derive(Default)]
    struct Teste {
        m: Maquina,
        t: u64,
    }

    impl Teste {
        fn agora(&mut self, usos: &[Uso]) -> Vec<Evento> {
            self.m.avancar(self.t, usos)
        }

        fn por(&mut self, ms: u64, usos: &[Uso]) -> Vec<Evento> {
            let fim = self.t + ms;
            let mut eventos = Vec::new();
            while self.t < fim {
                self.t = (self.t + POLL_MS).min(fim);
                eventos.extend(self.m.avancar(self.t, usos));
            }
            eventos
        }
    }

    fn comecou(id: u64, app: &str, titulo: Option<&str>) -> Evento {
        Evento::Started {
            id,
            app: app.into(),
            titulo: titulo.map(Into::into),
        }
    }

    #[test]
    fn zoom_vira_reuniao_2s_depois_de_abrir_o_microfone() {
        let mut t = Teste::default();
        let usos = [Uso::novo("Zoom.exe", &[])];
        assert!(t.agora(&usos).is_empty());
        assert!(t.por(1000, &usos).is_empty(), "2 s ainda não passaram");
        assert_eq!(t.por(1000, &usos), vec![comecou(1, "zoom", None)]);
        // E não repete enquanto a reunião durar.
        assert!(t.por(60_000, &usos).is_empty());
    }

    #[test]
    fn microfone_que_pisca_nao_vira_reuniao() {
        let mut t = Teste::default();
        let usos = [Uso::novo("Zoom.exe", &[])];
        assert!(t.por(1000, &usos).is_empty());
        assert!(t.por(1000, &[]).is_empty());
        assert!(t.por(1000, &usos).is_empty(), "a contagem recomeça do zero");
    }

    #[test]
    fn navegador_sem_titulo_de_reuniao_vira_aviso_generico_depois_de_um_minuto() {
        let mut t = Teste::default();
        let usos = [Uso::novo("chrome.exe", &["WhatsApp"])];
        assert!(t.agora(&usos).is_empty());
        assert!(t.por(59_000, &usos).is_empty());
        assert_eq!(t.por(1000, &usos), vec![comecou(1, "chrome", None)]);
        assert!(t.por(120_000, &usos).is_empty());
    }

    #[test]
    fn navegador_com_titulo_de_meet_vira_reuniao() {
        let mut t = Teste::default();
        let usos = [Uso::novo("chrome.exe", &["Meet - abc-defg-hij - Google Chrome"])];
        assert!(t.agora(&usos).is_empty());
        assert_eq!(
            t.por(2000, &usos),
            vec![comecou(1, "meet", Some("Meet - abc-defg-hij - Google Chrome"))]
        );
    }

    #[test]
    fn titulo_de_dentro_da_reuniao_do_meet_conta() {
        // O título que escapou no diagnóstico de 25/09: dois-pontos, e não hífen.
        let mut t = Teste::default();
        let usos = [Uso::novo("chrome.exe", &["Meet: bch-nxpf-jmm - Google Chrome"])];
        t.agora(&usos);
        assert_eq!(
            t.por(2000, &usos),
            vec![comecou(1, "meet", Some("Meet: bch-nxpf-jmm - Google Chrome"))]
        );
    }

    #[test]
    fn codigo_da_sala_sozinho_conta() {
        assert_eq!(app_do_titulo("bch-nxpf-jmm - google chrome"), Some("meet"));
        assert_eq!(app_do_titulo("sala bch-nxpf-jmm"), Some("meet"));
        // Parecido, mas não é código de sala.
        assert_eq!(app_do_titulo("abc-defgh-ijk"), None);
        assert_eq!(app_do_titulo("xabc-defg-hij"), None);
        assert_eq!(app_do_titulo("abc-defg-hijk"), None);
        assert_eq!(app_do_titulo("abc-def1-hij"), None);
        assert_eq!(app_do_titulo("pedidos-2024"), None);
    }

    #[test]
    fn teams_e_zoom_na_web() {
        assert_eq!(
            app_do_titulo(&"Ingresso na reunião | Reunião do Microsoft Teams | Microsoft Teams".to_lowercase()),
            Some("teams")
        );
        assert_eq!(app_do_titulo("zoom meeting"), Some("zoom"));
        assert_eq!(app_do_titulo("app.zoom.us - google chrome"), Some("zoom"));
        assert_eq!(app_do_titulo("reunião do zoom - microsoft edge"), Some("zoom"));
        assert_eq!(app_do_titulo("whatsapp"), None);
        assert_eq!(app_do_titulo("google docs"), None);
    }

    #[test]
    fn titulo_que_aparece_depois_ainda_vira_reuniao() {
        // Quem entra na reunião com o microfone já aberto: o título de reunião
        // chega depois, e o aviso sai na hora em que ele aparece.
        let mut t = Teste::default();
        let sem = [Uso::novo("chrome.exe", &["WhatsApp"])];
        t.agora(&sem);
        assert!(t.por(40_000, &sem).is_empty());
        let com = [Uso::novo("chrome.exe", &["Meet: bch-nxpf-jmm - Google Chrome"])];
        assert_eq!(
            t.por(1000, &com),
            vec![comecou(1, "meet", Some("Meet: bch-nxpf-jmm - Google Chrome"))]
        );
    }

    #[test]
    fn aviso_generico_nao_se_repete_quando_o_titulo_aparece() {
        let mut t = Teste::default();
        let sem = [Uso::novo("msedge.exe", &["Nova guia"])];
        t.agora(&sem);
        assert_eq!(t.por(60_000, &sem), vec![comecou(1, "edge", None)]);
        let com = [Uso::novo("msedge.exe", &["Meet: bch-nxpf-jmm - Microsoft Edge"])];
        assert!(t.por(10_000, &com).is_empty(), "é a mesma reunião");
    }

    #[test]
    fn outros_navegadores_tambem_contam() {
        for exe in ["opera.exe", "vivaldi.exe", "arc.exe", "brave.exe", "firefox.exe"] {
            let mut t = Teste::default();
            let usos = [Uso::novo(exe, &["Meet - abc-defg-hij"])];
            t.agora(&usos);
            assert_eq!(t.por(2000, &usos).len(), 1, "{exe}");
        }
    }

    #[test]
    fn arc_da_store_e_reconhecido_pelo_pacote() {
        assert_eq!(normalizar_exe("TheBrowserCompany.Arc_ttt1ap7aakyb4"), "arc.exe");
        assert_eq!(normalizar_exe("Zoom.exe"), "zoom.exe");
    }

    #[test]
    fn o_proprio_dito_nunca_vira_reuniao() {
        let mut t = Teste::default();
        let usos = [Uso::novo("Dito.exe", &["Dito"])];
        assert!(t.por(120_000, &usos).is_empty());
    }

    #[test]
    fn fim_depois_de_20s_de_microfone_livre() {
        let mut t = Teste::default();
        let usos = [Uso::novo("ms-teams.exe", &[])];
        t.agora(&usos);
        assert_eq!(t.por(2000, &usos).len(), 1);
        assert!(t.agora(&[]).is_empty());
        assert!(t.por(19_000, &[]).is_empty());
        assert_eq!(t.por(1000, &[]), vec![Evento::Ended { id: 1 }]);
    }

    #[test]
    fn microfone_que_some_por_pouco_nao_encerra() {
        let mut t = Teste::default();
        let usos = [Uso::novo("Zoom.exe", &[])];
        t.agora(&usos);
        assert_eq!(t.por(2000, &usos).len(), 1);
        assert!(t.por(10_000, &[]).is_empty());
        assert!(t.por(1000, &usos).is_empty());
        assert!(t.por(19_000, &[]).is_empty(), "a contagem de fim recomeçou");
    }

    #[test]
    fn duas_reunioes_seguidas_tem_ids_diferentes() {
        let mut t = Teste::default();
        let usos = [Uso::novo("Zoom.exe", &[])];
        t.agora(&usos);
        assert_eq!(t.por(2000, &usos).len(), 1);
        t.agora(&[]);
        assert_eq!(t.por(20_000, &[]), vec![Evento::Ended { id: 1 }]);
        t.agora(&usos);
        assert_eq!(t.por(2000, &usos), vec![comecou(2, "zoom", None)]);
    }

    #[test]
    fn app_dedicado_tem_preferencia_sobre_navegador() {
        let mut t = Teste::default();
        let usos = [
            Uso::novo("chrome.exe", &["Meet - abc-defg-hij"]),
            Uso::novo("Zoom.exe", &[]),
        ];
        t.agora(&usos);
        assert_eq!(t.por(2000, &usos), vec![comecou(1, "zoom", None)]);
    }

    #[test]
    fn gravar_o_dito_durante_a_reuniao_nao_encerra_nem_reinicia() {
        let mut t = Teste::default();
        let zoom = [Uso::novo("Zoom.exe", &[])];
        t.agora(&zoom);
        assert_eq!(t.por(2000, &zoom).len(), 1);
        let com_dito = [Uso::novo("Zoom.exe", &[]), Uso::novo("Dito.exe", &[])];
        assert!(t.por(60_000, &com_dito).is_empty());
    }

    #[test]
    fn reuniao_nova_entra_sem_esperar_a_antiga_terminar() {
        // O diagnóstico de 25/09: saiu do Meet às 11:46:38, o Teams abriu o
        // microfone às 11:46:49. Antes o Teams só era visto depois dos 20 s
        // de fim do Meet; agora a troca acontece 2 s depois de ele abrir.
        let mut t = Teste::default();
        let meet = [Uso::novo("chrome.exe", &["Meet: bch-nxpf-jmm - Google Chrome"])];
        t.agora(&meet);
        assert_eq!(t.por(2000, &meet).len(), 1);
        assert!(t.por(30_000, &meet).is_empty());

        assert!(t.agora(&[]).is_empty(), "saiu do Meet");
        assert!(t.por(11_000, &[]).is_empty());

        let teams = [Uso::novo("ms-teams.exe", &[])];
        assert!(t.agora(&teams).is_empty());
        assert!(t.por(1000, &teams).is_empty());
        assert_eq!(
            t.por(1000, &teams),
            vec![Evento::Ended { id: 1 }, comecou(2, "teams", None)]
        );
        // E o fim do Meet não chega de novo depois.
        assert!(t.por(30_000, &teams).is_empty());
    }

    #[test]
    fn outro_programa_nao_interrompe_a_reuniao_com_microfone_aberto() {
        let mut t = Teste::default();
        let zoom = [Uso::novo("Zoom.exe", &[])];
        t.agora(&zoom);
        assert_eq!(t.por(2000, &zoom).len(), 1);
        let os_dois = [Uso::novo("Zoom.exe", &[]), Uso::novo("ms-teams.exe", &[])];
        assert!(t.por(60_000, &os_dois).is_empty());
    }

    #[test]
    fn navegador_qualquer_nao_encerra_a_reuniao_antes_da_hora() {
        // Microfone livre no Teams e um áudio de WhatsApp no Chrome: o Teams
        // termina pelos 20 s de sempre, e não porque o Chrome abriu o microfone.
        let mut t = Teste::default();
        let teams = [Uso::novo("ms-teams.exe", &[])];
        t.agora(&teams);
        assert_eq!(t.por(2000, &teams).len(), 1);
        t.agora(&[]);
        let whatsapp = [Uso::novo("chrome.exe", &["WhatsApp"])];
        assert!(t.por(19_000, &whatsapp).is_empty());
        assert_eq!(t.por(1000, &whatsapp), vec![Evento::Ended { id: 1 }]);
    }

    #[test]
    fn o_log_diz_o_que_aconteceu_sem_o_titulo() {
        let mut t = Teste::default();
        let usos = [Uso::novo("chrome.exe", &["Meet: bch-nxpf-jmm - Google Chrome"])];
        t.agora(&usos);
        t.por(2000, &usos);
        let notas = t.m.tirar_notas();
        assert!(notas.iter().any(|n| n == "microfone com: chrome.exe"), "{notas:?}");
        assert!(notas.iter().any(|n| n.contains("título de reunião do meet")), "{notas:?}");
        assert!(notas.iter().any(|n| n.starts_with("reunião 1 começou (meet), 2.0 s")), "{notas:?}");
        assert!(notas.iter().all(|n| !n.contains("bch-nxpf-jmm")), "{notas:?}");
        assert!(t.m.tirar_notas().is_empty(), "as notas saem uma vez só");
    }
}
