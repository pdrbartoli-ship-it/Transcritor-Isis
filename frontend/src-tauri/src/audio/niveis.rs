//! Quanto som veio de cada lado, a cada 250 ms, para o servidor saber quem
//! falou: o que sai do microfone é a pessoa que gravou, e o que sai do som do
//! computador são os outros da chamada.
//!
//! O .wav continua mono e do mesmo tamanho. O que vai junto é só isto: dois
//! caracteres por janela de 250 ms (o volume do microfone e o do computador),
//! uns 29 KB por hora de gravação. Gravar os dois lados em canais separados
//! dobraria o arquivo e pediria duas passadas do Whisper, e o Whisper inventa
//! frase em cima do canal que fica calado enquanto o outro fala.
//!
//! A decisão de quem falou mora no servidor (`marcar_canais`, backend/main.py),
//! e não aqui: ajustar a regra lá é um push, e aqui seria um instalador novo.
//!
//! Formato: `"250:"` seguido dos pares. Cada caractere é um degrau de 0 a 63
//! no alfabeto base64 de URL, de -72 dBFS (ou menos) até 0 dBFS, cerca de
//! 1,1 dB por degrau.

/// Tamanho de cada janela. O Whisper corta a fala em trechos de 2 a 10 s, então
/// um quarto de segundo sobra para dizer de que lado veio cada um.
pub const JANELA_MS: u32 = 250;
const ALFABETO: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const PISO_DB: f64 = -72.0;

pub struct Niveis {
    amostras_por_janela: usize,
    contagem: usize,
    soma_mic: f64,
    soma_sis: f64,
    texto: String,
}

impl Niveis {
    pub fn novo(taxa: u32) -> Self {
        Niveis {
            amostras_por_janela: (taxa * JANELA_MS / 1000).max(1) as usize,
            contagem: 0,
            soma_mic: 0.0,
            soma_sis: 0.0,
            texto: format!("{JANELA_MS}:"),
        }
    }

    /// Uma amostra de cada lado, na mesma ordem em que entram no .wav. É isso
    /// que mantém as janelas no mesmo relógio do arquivo: pausa e teto, que não
    /// escrevem no .wav, também não passam por aqui.
    pub fn somar(&mut self, mic: f32, sis: f32) {
        self.soma_mic += (mic as f64) * (mic as f64);
        self.soma_sis += (sis as f64) * (sis as f64);
        self.contagem += 1;
        if self.contagem == self.amostras_por_janela {
            self.fechar_janela();
        }
    }

    /// O texto pronto, com a última janela (mesmo incompleta) incluída.
    pub fn terminar(mut self) -> String {
        if self.contagem > 0 {
            self.fechar_janela();
        }
        self.texto
    }

    fn fechar_janela(&mut self) {
        let n = self.contagem as f64;
        self.texto.push(codigo((self.soma_mic / n).sqrt()));
        self.texto.push(codigo((self.soma_sis / n).sqrt()));
        self.contagem = 0;
        self.soma_mic = 0.0;
        self.soma_sis = 0.0;
    }
}

/// O volume eficaz (RMS, de 0 a 1) como um caractere.
fn codigo(rms: f64) -> char {
    let db = if rms > 0.0 { 20.0 * rms.log10() } else { PISO_DB };
    let degrau = ((db - PISO_DB) / -PISO_DB * 63.0).round().clamp(0.0, 63.0) as usize;
    ALFABETO[degrau] as char
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silencio_e_volume_cheio_nas_pontas_do_alfabeto() {
        assert_eq!(codigo(0.0), 'A');
        assert_eq!(codigo(1.0), '_');
        // -36 dBFS fica no meio da escala.
        assert_eq!(codigo(10f64.powf(-36.0 / 20.0)), ALFABETO[32] as char);
    }

    #[test]
    fn uma_janela_a_cada_250_ms_com_os_dois_lados() {
        let mut niveis = Niveis::novo(16_000);
        // Meio segundo: 250 ms só de microfone e 250 ms só do computador.
        for _ in 0..4000 {
            niveis.somar(0.5, 0.0);
        }
        for _ in 0..4000 {
            niveis.somar(0.0, 0.5);
        }
        // E uma sobra de 10 ms, que ainda vira janela.
        for _ in 0..160 {
            niveis.somar(0.0, 0.0);
        }
        let texto = niveis.terminar();
        let (janela, pares) = texto.split_once(':').unwrap();
        assert_eq!(janela, "250");
        assert_eq!(pares.len(), 6);
        let alto = codigo(0.5);
        assert_eq!(pares, format!("{alto}AA{alto}AA"));
    }
}
