import Foundation
import AVFoundation
import UIKit
import UserNotifications
import Capacitor

/// Gravador nativo do iPhone.
///
/// Até aqui quem gravava no celular era a página (o microfone do WebView), e o
/// iPhone corta o microfone de quem sai da tela: travar o celular no meio de
/// uma reunião perdia o resto dela sem aviso. Aqui a gravação é do próprio
/// app, com o modo de áudio em segundo plano (`UIBackgroundModes: audio` no
/// Info.plist), e continua com a tela travada ou com outro app na frente.
///
/// O arquivo é AAC em quadros soltos (ADTS, ".aac"): cada quadro se sustenta
/// sozinho, então um app fechado à força no meio deixa um arquivo legível até
/// o último segundo gravado. Um .m4a só fica legível depois de fechado.
///
/// O estado vai para o UserDefaults a cada 2 segundos. Se o app for fechado no
/// meio, a próxima abertura encontra a gravação como "interrompida", com o
/// arquivo e a duração, e o app oferece transcrever o que ficou.
@objc(GravadorPlugin)
public class GravadorPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioRecorderDelegate {
    public let identifier = "GravadorPlugin"
    public let jsName = "GravadorNativo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "iniciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pausar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retomar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "encerrar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "estado", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "descartar", returnType: CAPPluginReturnPromise)
    ]

    private static let chave = "dito.gravador"

    // Abaixo deste pico a gravação inteira foi silêncio digital (microfone
    // tomado por uma ligação, por exemplo). Bem abaixo do rumor de qualquer
    // sala: recusar uma gravação boa é pior que deixar passar uma muda.
    private static let limiarSom: Float = 0.0003

    // Na ordem de preferência. O ".aac" é o que sobrevive ao app fechado à
    // força; o ".m4a" fica de reserva caso o iPhone recuse o primeiro. Fala não
    // precisa de mais que 32 kbps em mono, o mesmo que o gravador da página usa.
    private static let formatos: [(ext: String, mime: String)] = [("aac", "audio/aac"), ("m4a", "audio/mp4")]
    private static let ajustes: [[String: Any]] = [
        [AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32_000],
        [AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64_000]
    ]

    private enum Falha: Error { case semFormato, naoGravou }

    // Tudo abaixo só é lido e escrito na fila principal.
    private var gravador: AVAudioRecorder?
    private var relogio: DispatchSourceTimer?
    private var situacao = "parado" // parado | gravando | pausado | encerrado
    private var motivo: String?
    private var caminho: URL?
    private var mime = "audio/aac"
    private var acumuladoMs: Double = 0
    private var inicioTrecho: Date?
    private var pico: Float = 0
    private var maxMs: Double?
    private var ultimaPersistencia = Date.distantPast

    override public func load() {
        restaurar()
        let centro = NotificationCenter.default
        centro.addObserver(self, selector: #selector(interrupcao(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        centro.addObserver(self, selector: #selector(vaiFechar), name: UIApplication.willTerminateNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Métodos chamados pelo JS

    @objc func iniciar(_ call: CAPPluginCall) {
        let maxSegundos = call.getDouble("maxSegundos") ?? 0
        DispatchQueue.main.async {
            if self.situacao == "gravando" || self.situacao == "pausado" {
                call.reject("Já existe uma gravação em andamento.")
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { permitido in
                DispatchQueue.main.async {
                    guard permitido else {
                        call.reject("Acesso ao microfone negado. Autorize o microfone do Dito nos Ajustes do iPhone e tente de novo.", "SEM_PERMISSAO")
                        return
                    }
                    do {
                        try self.comecar(maxMs: maxSegundos > 0 ? maxSegundos * 1000 : nil)
                        call.resolve(self.resumo())
                    } catch {
                        self.limpar()
                        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                        call.reject("Não foi possível iniciar a gravação.", "FALHOU", error)
                    }
                }
            }
        }
    }

    @objc func pausar(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.situacao == "gravando" { self.pausarAgora(motivo: nil) }
            call.resolve(self.resumo())
        }
    }

    @objc func retomar(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.situacao == "pausado" && !self.retomarAgora() {
                call.reject("Não foi possível retomar a gravação.")
                return
            }
            call.resolve(self.resumo())
        }
    }

    @objc func encerrar(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finalizar(motivo: "voce")
            guard self.situacao == "encerrado" else {
                call.reject("Não há gravação para encerrar.")
                return
            }
            call.resolve(self.resumo())
        }
    }

    @objc func estado(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.resumo())
        }
    }

    /// Apaga o arquivo de uma gravação já lida pelo app. Uma gravação em
    /// andamento não se descarta por aqui: primeiro ela precisa ser encerrada.
    @objc func descartar(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.situacao == "encerrado" || self.situacao == "parado" { self.limpar() }
            call.resolve(self.resumo())
        }
    }

    // MARK: - Gravação

    private func comecar(maxMs: Double?) throws {
        let sessao = AVAudioSession.sharedInstance()
        // playAndRecord misturável: gravar não cala o podcast ou a chamada de
        // outro app. `defaultToSpeaker` evita que o som dos outros apps passe
        // para o alto-falante de ouvido; `allowBluetoothA2DP` mantém o fone de
        // ouvido tocando, com o microfone do próprio iPhone gravando a sala.
        try sessao.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothA2DP])
        try sessao.setActive(true)

        apagarGravacoes()
        let pasta = try pastaDasGravacoes()
        let nome = "gravacao-\(Int(Date().timeIntervalSince1970))"

        var escolhido: (gravador: AVAudioRecorder, url: URL, mime: String)?
        busca: for formato in Self.formatos {
            for ajuste in Self.ajustes {
                let url = pasta.appendingPathComponent("\(nome).\(formato.ext)")
                if let r = try? AVAudioRecorder(url: url, settings: ajuste), r.prepareToRecord() {
                    escolhido = (r, url, formato.mime)
                    break busca
                }
                try? FileManager.default.removeItem(at: url)
            }
        }
        guard let achado = escolhido else { throw Falha.semFormato }

        achado.gravador.delegate = self
        achado.gravador.isMeteringEnabled = true
        guard achado.gravador.record() else { throw Falha.naoGravou }

        gravador = achado.gravador
        caminho = achado.url
        mime = achado.mime
        situacao = "gravando"
        motivo = nil
        acumuladoMs = 0
        inicioTrecho = Date()
        pico = 0
        self.maxMs = maxMs
        ligarRelogio()
        persistir()
    }

    private func pausarAgora(motivo: String?) {
        gravador?.pause()
        fecharTrecho()
        situacao = "pausado"
        self.motivo = motivo
        persistir()
        avisarMudanca()
    }

    @discardableResult
    private func retomarAgora() -> Bool {
        guard let r = gravador else { return false }
        try? AVAudioSession.sharedInstance().setActive(true)
        guard r.record() else { return false }
        inicioTrecho = Date()
        situacao = "gravando"
        motivo = nil
        persistir()
        avisarMudanca()
        return true
    }

    private func finalizar(motivo: String) {
        guard situacao == "gravando" || situacao == "pausado" else { return }
        fecharTrecho()
        // Solto antes do stop(): o delegate também é chamado pelo nosso próprio
        // stop(), e só deve agir quando o sistema parar a gravação sozinho.
        let r = gravador
        gravador = nil
        r?.stop()
        relogio?.cancel()
        relogio = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        situacao = "encerrado"
        self.motivo = motivo
        persistir()
        avisarMudanca()
    }

    private func limpar() {
        if let c = caminho { try? FileManager.default.removeItem(at: c) }
        caminho = nil
        situacao = "parado"
        motivo = nil
        acumuladoMs = 0
        inicioTrecho = nil
        pico = 0
        maxMs = nil
        persistir()
    }

    // O relógio mede o nível para a onda, guarda o pico, fecha a gravação no
    // teto do saldo e salva o estado. Roda também com a tela travada: o app
    // continua vivo enquanto grava.
    private func ligarRelogio() {
        relogio?.cancel()
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + 0.1, repeating: 0.1)
        t.setEventHandler { [weak self] in self?.tique() }
        t.resume()
        relogio = t
    }

    private func tique() {
        guard let r = gravador else { return }
        if situacao == "gravando" {
            r.updateMeters()
            let db = r.peakPower(forChannel: 0)
            let nivel: Float = db <= -120 ? 0 : min(1, powf(10, db / 20))
            pico = max(pico, nivel)
            // Com o app fora da tela o WebView está congelado: eventos aqui só
            // se acumulariam para chegar todos juntos na volta.
            if UIApplication.shared.applicationState == .active {
                notifyListeners("nivel", data: ["nivel": Double(nivel)])
            }
            if let teto = maxMs, duracaoMs() >= teto {
                finalizar(motivo: "limite")
                return
            }
        }
        if Date().timeIntervalSince(ultimaPersistencia) >= 2 { persistir() }
    }

    private func duracaoMs() -> Double {
        guard let inicio = inicioTrecho else { return acumuladoMs }
        return acumuladoMs + Date().timeIntervalSince(inicio) * 1000
    }

    private func fecharTrecho() {
        acumuladoMs = duracaoMs()
        inicioTrecho = nil
    }

    // MARK: - Ligação e fechamento

    // Uma ligação toma o microfone. O iPhone já pausa o gravador; aqui o
    // estado acompanha, e no fim da ligação a gravação volta sozinha quando o
    // sistema deixa. Quando não deixa, uma notificação avisa que está pausada.
    @objc private func interrupcao(_ aviso: Notification) {
        guard let info = aviso.userInfo,
              let bruto = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let tipo = AVAudioSession.InterruptionType(rawValue: bruto) else { return }
        let opcoes = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        DispatchQueue.main.async {
            switch tipo {
            case .began:
                guard self.situacao == "gravando" else { return }
                self.pausarAgora(motivo: "ligacao")
            case .ended:
                guard self.situacao == "pausado", self.motivo == "ligacao" else { return }
                if opcoes.contains(.shouldResume) && self.retomarAgora() { return }
                self.notificar(titulo: "Gravação pausada", texto: "Uma ligação interrompeu a gravação. Abra o Dito para retomar.")
            @unknown default:
                break
            }
        }
    }

    // Tirar o app da lista de abertos com a gravação em segundo plano chega
    // aqui. Fechar o arquivo com calma deixa até o .m4a de reserva legível.
    @objc private func vaiFechar() {
        finalizar(motivo: "interrompida")
    }

    public func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        DispatchQueue.main.async {
            guard recorder === self.gravador else { return }
            self.finalizar(motivo: "erro")
        }
    }

    public func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        DispatchQueue.main.async {
            guard recorder === self.gravador else { return }
            self.finalizar(motivo: "erro")
        }
    }

    // MARK: - Estado salvo

    private func resumo() -> [String: Any] {
        var r: [String: Any] = [
            "estado": situacao,
            "duracaoMs": Int(duracaoMs()),
            "teveSom": pico >= Self.limiarSom,
            "mime": mime
        ]
        if let c = caminho { r["caminho"] = c.path }
        if let m = motivo { r["motivo"] = m }
        if let m = maxMs { r["maxMs"] = Int(m) }
        return r
    }

    private func avisarMudanca() {
        notifyListeners("mudou", data: resumo())
    }

    private func persistir() {
        ultimaPersistencia = Date()
        guard situacao != "parado", let c = caminho else {
            UserDefaults.standard.removeObject(forKey: Self.chave)
            return
        }
        var d: [String: Any] = [
            "estado": situacao,
            "caminho": c.path,
            "mime": mime,
            "duracaoMs": duracaoMs(),
            "pico": Double(pico)
        ]
        if let m = motivo { d["motivo"] = m }
        if let m = maxMs { d["maxMs"] = m }
        UserDefaults.standard.set(d, forKey: Self.chave)
    }

    private func restaurar() {
        guard let salvo = UserDefaults.standard.dictionary(forKey: Self.chave),
              let e = salvo["estado"] as? String,
              let p = salvo["caminho"] as? String,
              FileManager.default.fileExists(atPath: p) else {
            UserDefaults.standard.removeObject(forKey: Self.chave)
            return
        }
        caminho = URL(fileURLWithPath: p)
        mime = salvo["mime"] as? String ?? "audio/aac"
        acumuladoMs = salvo["duracaoMs"] as? Double ?? 0
        pico = Float(salvo["pico"] as? Double ?? 1)
        maxMs = salvo["maxMs"] as? Double
        situacao = "encerrado"
        // Processo novo não tem gravador: se o salvo dizia "gravando", o app
        // foi fechado no meio, e o arquivo até ali é o que sobrou.
        if e == "gravando" || e == "pausado" {
            motivo = "interrompida"
        } else {
            motivo = salvo["motivo"] as? String
        }
        persistir()
    }

    // MARK: - Arquivos e aviso

    // Library, e não Application Support: o caminho vira URL no WebView, e
    // sem espaço no nome não há o que codificar no meio.
    private func pastaDasGravacoes() throws -> URL {
        let base = try FileManager.default.url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let pasta = base.appendingPathComponent("Gravacoes", isDirectory: true)
        try FileManager.default.createDirectory(at: pasta, withIntermediateDirectories: true)
        return pasta
    }

    private func apagarGravacoes() {
        guard let pasta = try? pastaDasGravacoes(),
              let itens = try? FileManager.default.contentsOfDirectory(at: pasta, includingPropertiesForKeys: nil) else { return }
        for item in itens { try? FileManager.default.removeItem(at: item) }
    }

    // Sem permissão de notificação, o pedido é recusado em silêncio: a
    // gravação continua pausada e o app mostra o motivo quando for aberto.
    private func notificar(titulo: String, texto: String) {
        let conteudo = UNMutableNotificationContent()
        conteudo.title = titulo
        conteudo.body = texto
        let pedido = UNNotificationRequest(identifier: "dito.gravador", content: conteudo, trigger: nil)
        UNUserNotificationCenter.current().add(pedido, withCompletionHandler: nil)
    }
}
