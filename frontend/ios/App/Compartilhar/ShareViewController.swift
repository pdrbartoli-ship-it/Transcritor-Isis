import UIKit
import UniformTypeIdentifiers

/// A extensão de compartilhar do Dito: é o que põe o Dito na lista de
/// compartilhar do WhatsApp, do YouTube e de qualquer outro app.
///
/// Ela não transcreve nada. Guarda o que recebeu (o áudio ou o link) na pasta
/// que divide com o app (App Group), deixa um bilhete dizendo o que é e abre o
/// Dito, que segue pelo mesmo caminho do Android: sharedContent.js leva à
/// home, e o painel de captura começa sozinho. Quem lê o bilhete do lado do
/// app é o SharedContentPlugin (plugins/gravador).
final class ShareViewController: UIViewController {
    // O mesmo nome nas duas pontas e nos dois arquivos .entitlements.
    private static let grupo = "group.br.com.albiecloud.dito"
    private static let enderecoDoApp = URL(string: "dito://compartilhar")!

    private let rotulo = UILabel()
    private let giro = UIActivityIndicatorView(style: .medium)
    private let botao = UIButton(type: .system)
    private var comecou = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        rotulo.text = "Abrindo o Dito"
        rotulo.font = .preferredFont(forTextStyle: .body)
        rotulo.textAlignment = .center
        rotulo.numberOfLines = 0
        giro.startAnimating()
        botao.setTitle("OK", for: .normal)
        botao.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        botao.isHidden = true
        botao.addTarget(self, action: #selector(fechar), for: .touchUpInside)

        let pilha = UIStackView(arrangedSubviews: [giro, rotulo, botao])
        pilha.axis = .vertical
        pilha.alignment = .center
        pilha.spacing = 16
        pilha.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pilha)
        NSLayoutConstraint.activate([
            pilha.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            pilha.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            pilha.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !comecou else { return }
        comecou = true
        receber()
    }

    // MARK: - O que chegou

    private func anexos() -> [NSItemProvider] {
        let itens = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        return itens.flatMap { $0.attachments ?? [] }
    }

    /// Áudio ou vídeo primeiro: o WhatsApp manda o áudio e, às vezes, um texto
    /// junto. Link só quando não há arquivo. Vários áudios de uma vez ainda
    /// viram só o primeiro: juntar vários numa conversa é um passo à parte.
    private func receber() {
        let lista = anexos()
        if let anexo = lista.first(where: { Self.tipoDeMidia($0) != nil }), let tipo = Self.tipoDeMidia(anexo) {
            anexo.loadFileRepresentation(forTypeIdentifier: tipo) { url, _ in
                let guardado = url.flatMap { self.guardarArquivo($0, nome: anexo.suggestedName) }
                DispatchQueue.main.async {
                    if let arquivo = guardado {
                        self.entregar(["type": "file", "arquivo": arquivo.arquivo, "name": arquivo.nome])
                    } else {
                        self.mostrar("Não foi possível abrir este arquivo.")
                    }
                }
            }
            return
        }
        if let anexo = lista.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            anexo.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                let url = (item as? URL) ?? (item as? String).flatMap(URL.init(string:))
                DispatchQueue.main.async {
                    // Um endereço de arquivo aqui é arquivo que não é áudio nem vídeo.
                    if let url = url, url.scheme == "http" || url.scheme == "https" {
                        self.entregar(["type": "text", "value": url.absoluteString])
                    } else {
                        self.mostrar("O Dito transcreve áudios, vídeos e links de vídeo.")
                    }
                }
            }
            return
        }
        if let anexo = lista.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            anexo.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                let texto = (item as? String) ?? ""
                DispatchQueue.main.async {
                    // O YouTube às vezes manda "Título do vídeo https://youtu.be/x";
                    // a página tira o link do meio do texto.
                    if texto.contains("http://") || texto.contains("https://") {
                        self.entregar(["type": "text", "value": texto])
                    } else {
                        self.mostrar("Não há link neste texto. O Dito transcreve áudios, vídeos e links de vídeo.")
                    }
                }
            }
            return
        }
        mostrar("O Dito transcreve áudios, vídeos e links de vídeo.")
    }

    /// O tipo pelo qual pedir o arquivo, se o anexo for áudio ou vídeo. O áudio
    /// de voz do WhatsApp é Opus, que nem todo iPhone conhece por nome: entra
    /// também pelo nome do tipo e pelo tipo genérico que o sistema inventa
    /// para extensão desconhecida ("dyn.").
    private static func tipoDeMidia(_ anexo: NSItemProvider) -> String? {
        let tipos = anexo.registeredTypeIdentifiers
        if let conhecido = tipos.first(where: { UTType($0)?.conforms(to: .audiovisualContent) == true }) {
            return conhecido
        }
        return tipos.first { t in
            let minusculo = t.lowercased()
            return minusculo.contains("opus") || minusculo.contains("ogg") || minusculo.hasPrefix("dyn.")
        }
    }

    // MARK: - Entregar ao app

    /// Copia o arquivo para a pasta do grupo. Roda dentro da resposta do
    /// loadFileRepresentation porque o arquivo recebido some assim que ela
    /// termina. A pasta é limpa antes: só o último compartilhamento importa.
    private func guardarArquivo(_ origem: URL, nome sugerido: String?) -> (arquivo: String, nome: String)? {
        guard let pasta = Self.pasta() else { return nil }
        let arquivos = (try? FileManager.default.contentsOfDirectory(at: pasta, includingPropertiesForKeys: nil)) ?? []
        arquivos.forEach { try? FileManager.default.removeItem(at: $0) }

        var nome = origem.lastPathComponent
        if let sugerido = sugerido, !sugerido.isEmpty {
            nome = (sugerido as NSString).pathExtension.isEmpty && !origem.pathExtension.isEmpty
                ? "\(sugerido).\(origem.pathExtension)"
                : sugerido
        }
        nome = nome.replacingOccurrences(of: "/", with: "_")
        // O nome no disco é só letra sem acento, número, ponto e traço: ele
        // vira endereço para a página ler o arquivo, e um "#" ou "?" no nome
        // cortaria o endereço no meio. O nome original segue no bilhete, para
        // a conversa. O prefixo de tempo evita que dois áudios de mesmo nome
        // (comum no WhatsApp) se confundam.
        let permitidos = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        let traco: Unicode.Scalar = "_"
        var limpo = ""
        for letra in nome.unicodeScalars {
            limpo.unicodeScalars.append(permitidos.contains(letra) ? letra : traco)
        }
        let arquivo = "\(Int(Date().timeIntervalSince1970))-\(limpo)"
        do {
            try FileManager.default.copyItem(at: origem, to: pasta.appendingPathComponent(arquivo))
            return (arquivo, nome)
        } catch {
            return nil
        }
    }

    private func entregar(_ bilhete: [String: Any]) {
        var completo = bilhete
        completo["em"] = Date().timeIntervalSince1970 * 1000
        guard let pasta = Self.pasta(),
              let dados = try? JSONSerialization.data(withJSONObject: completo),
              (try? dados.write(to: pasta.appendingPathComponent("pendente.json"), options: .atomic)) != nil else {
            mostrar("Não foi possível passar isto para o Dito.")
            return
        }
        if abrirApp(Self.enderecoDoApp) {
            extensionContext?.completeRequest(returningItems: nil)
        } else {
            // O bilhete fica guardado: abrir o Dito pela tela inicial também
            // encontra o que foi compartilhado.
            mostrar("Pronto. Abra o Dito para transcrever.")
        }
    }

    /// Extensão não pode abrir outro app pelo caminho normal. O caminho que
    /// funciona é achar o UIApplication subindo pela cadeia de quem responde a
    /// toques e pedir a ele. A chamada vai pelo nome do método para o
    /// compilador de extensões não recusá-la.
    private func abrirApp(_ url: URL) -> Bool {
        let seletor = NSSelectorFromString("openURL:options:completionHandler:")
        var atual: UIResponder? = self
        while let r = atual {
            if let app = r as? UIApplication, app.responds(to: seletor) {
                typealias Abrir = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
                let abrir = unsafeBitCast(app.method(for: seletor), to: Abrir.self)
                abrir(app, seletor, url as NSURL, NSDictionary(), nil)
                return true
            }
            atual = r.next
        }
        return false
    }

    // MARK: - Tela

    private func mostrar(_ texto: String) {
        giro.stopAnimating()
        giro.isHidden = true
        rotulo.text = texto
        botao.isHidden = false
    }

    @objc private func fechar() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private static func pasta() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: grupo) else { return nil }
        let pasta = base.appendingPathComponent("Compartilhados", isDirectory: true)
        try? FileManager.default.createDirectory(at: pasta, withIntermediateDirectories: true)
        return pasta
    }
}
