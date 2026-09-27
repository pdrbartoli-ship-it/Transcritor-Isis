//! "Baixar a transcrição" no app de Windows: o arquivo vai para Downloads e o
//! Explorador abre com ele já selecionado, como o "Mostrar na pasta" do Chrome.
//!
//! No site, quem salva é o navegador, e ele já oferece a pasta. Dentro do app o
//! download caía em Downloads sem ninguém saber, e a página não tem como abrir
//! o Explorador: só a parte nativa do app consegue.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Nomes que o Windows reserva para dispositivos: um "CON.txt" não se cria.
const RESERVADOS: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Um nome que o Windows aceita, sempre em .txt. O título da conversa vem de
/// quem a nomeou (ou da IA), então pode trazer barra, dois-pontos ou aspas.
pub fn nome_seguro(nome: &str) -> String {
    let trocado: String = nome
        .chars()
        .map(|c| if c.is_control() || r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
        .collect();
    let sem_extensao = match trocado.len().checked_sub(4) {
        Some(i) if trocado.is_char_boundary(i) && trocado[i..].eq_ignore_ascii_case(".txt") => &trocado[..i],
        _ => trocado.as_str(),
    };
    let curto: String = sem_extensao.chars().take(80).collect();
    // O Windows não aceita nome terminado em ponto ou espaço.
    let base = curto.trim().trim_end_matches(['.', ' ']);
    let base = if base.is_empty() { "conversa" } else { base };
    if RESERVADOS.contains(&base.to_lowercase().as_str()) {
        format!("conversa-{base}.txt")
    } else {
        format!("{base}.txt")
    }
}

/// Grava sem nunca sobrescrever: se o nome já existe, tenta "nome (2).txt",
/// "nome (3).txt"... O `create_new` é o que garante isso de verdade: conferir
/// antes e gravar depois deixaria duas gravações seguidas brigarem pelo nome.
pub fn salvar_sem_sobrescrever(pasta: &Path, nome: &str, conteudo: &[u8]) -> io::Result<PathBuf> {
    let (base, extensao) = nome.rsplit_once('.').unwrap_or((nome, "txt"));
    for n in 1..1000 {
        let caminho = if n == 1 {
            pasta.join(nome)
        } else {
            pasta.join(format!("{base} ({n}).{extensao}"))
        };
        match OpenOptions::new().write(true).create_new(true).open(&caminho) {
            Ok(mut arquivo) => {
                arquivo.write_all(conteudo)?;
                return Ok(caminho);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "nomes esgotados"))
}

/// Abre o Explorador com o arquivo selecionado. É o próprio Explorador que
/// faz isso (`explorer /select,"caminho"`), sem script e sem nada rodando por
/// trás. Ele devolve código de saída 1 mesmo quando dá certo, então o
/// resultado não é conferido: o arquivo já está salvo de qualquer jeito.
#[cfg(windows)]
pub fn mostrar_na_pasta(caminho: &Path) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", caminho.display()))
        .spawn();
}

#[cfg(not(windows))]
pub fn mostrar_na_pasta(_caminho: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nome_seguro_tira_o_que_o_windows_recusa() {
        assert_eq!(nome_seguro("Reunião: vendas/Q3?.txt"), "Reunião- vendas-Q3-.txt");
        assert_eq!(nome_seguro("Consulta"), "Consulta.txt");
        assert_eq!(nome_seguro("  "), "conversa.txt");
        assert_eq!(nome_seguro("fim com ponto..."), "fim com ponto.txt");
        assert_eq!(nome_seguro("CON"), "conversa-CON.txt");
        assert_eq!(nome_seguro("Nota.TXT"), "Nota.txt");
        assert_eq!(nome_seguro(&"a".repeat(200)).chars().count(), 84);
    }

    #[test]
    fn nunca_sobrescreve_um_arquivo_que_ja_existe() {
        let pasta = std::env::temp_dir().join(format!("dito-teste-{}", std::process::id()));
        std::fs::create_dir_all(&pasta).unwrap();
        let primeiro = salvar_sem_sobrescrever(&pasta, "Consulta.txt", b"um").unwrap();
        let segundo = salvar_sem_sobrescrever(&pasta, "Consulta.txt", b"dois").unwrap();
        let terceiro = salvar_sem_sobrescrever(&pasta, "Consulta.txt", b"tres").unwrap();
        assert_eq!(primeiro.file_name().unwrap(), "Consulta.txt");
        assert_eq!(segundo.file_name().unwrap(), "Consulta (2).txt");
        assert_eq!(terceiro.file_name().unwrap(), "Consulta (3).txt");
        assert_eq!(std::fs::read(&primeiro).unwrap(), b"um");
        assert_eq!(std::fs::read(&segundo).unwrap(), b"dois");
        std::fs::remove_dir_all(&pasta).unwrap();
    }
}
