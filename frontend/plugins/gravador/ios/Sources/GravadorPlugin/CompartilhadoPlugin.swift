import Foundation
import Capacitor

/// Recebe o que a extensão de compartilhar (ios/App/Compartilhar) entrega ao
/// app: o áudio do WhatsApp, o link do YouTube.
///
/// Mesmo nome e mesmo formato do plugin do Android (SharedContentPlugin.java):
/// `consume()` devolve o que chegou e o descarta, e o evento `sharedContent`
/// avisa quando chega com o app já aberto. O lado da página
/// (sharedContent.js) é um só para os dois.
///
/// Mora no pacote do gravador só porque ele já está ligado ao projeto do
/// iPhone; não tem nada a ver com gravar.
///
/// A extensão roda em outro processo e não enxerga o app. O que ela recebe
/// vai para a pasta do grupo de apps (App Group), que os dois enxergam, com um
/// bilhete ("pendente.json") dizendo o que é; depois ela abre o app pelo
/// endereço dito://compartilhar.
@objc(SharedContentPlugin)
public class SharedContentPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SharedContentPlugin"
    public let jsName = "SharedContent"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consume", returnType: CAPPluginReturnPromise)
    ]

    // O mesmo nome nas duas pontas: aqui, na extensão (ShareViewController)
    // e nos dois arquivos .entitlements.
    private static let grupo = "group.br.com.albiecloud.dito"

    // Um bilhete mais velho que isto é de um compartilhamento que não abriu o
    // app, e a pessoa já esqueceu dele: transcrever agora seria uma surpresa.
    private static let validadeS: TimeInterval = 60 * 60

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(abriuPorEndereco(_:)), name: Notification.Name.capacitorOpenURL, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /// App aberto pelo compartilhamento: a página pergunta ao montar.
    @objc func consume(_ call: CAPPluginCall) {
        call.resolve(Self.retirarPendente() ?? [:])
    }

    /// App já aberto: o compartilhamento chega por aqui. O evento fica guardado
    /// até alguém ouvir, porque a tela que ouve pode ainda não estar montada
    /// (o login, por exemplo).
    @objc private func abriuPorEndereco(_ aviso: Notification) {
        guard let dados = aviso.object as? [String: Any],
              let url = dados["url"] as? URL,
              url.scheme == "dito", url.host == "compartilhar",
              let pendente = Self.retirarPendente() else { return }
        notifyListeners("sharedContent", data: pendente, retainUntilConsumed: true)
    }

    /// Lê o bilhete e o apaga, para o mesmo compartilhamento não ser
    /// transcrito duas vezes. O arquivo em si fica: a página ainda vai lê-lo, e
    /// a extensão limpa a pasta no compartilhamento seguinte.
    private static func retirarPendente() -> [String: Any]? {
        guard let pasta = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: grupo)?
            .appendingPathComponent("Compartilhados", isDirectory: true) else { return nil }
        let bilhete = pasta.appendingPathComponent("pendente.json")
        guard let dados = try? Data(contentsOf: bilhete) else { return nil }
        try? FileManager.default.removeItem(at: bilhete)
        guard let lido = try? JSONSerialization.jsonObject(with: dados) as? [String: Any],
              let tipo = lido["type"] as? String else { return nil }
        let em = lido["em"] as? Double ?? 0
        if Date().timeIntervalSince1970 - em / 1000 > validadeS { return nil }

        if tipo == "text", let valor = lido["value"] as? String {
            return ["type": "text", "value": valor]
        }
        if tipo == "file", let arquivo = lido["arquivo"] as? String {
            let caminho = pasta.appendingPathComponent(arquivo).path
            guard FileManager.default.fileExists(atPath: caminho) else { return nil }
            return ["type": "file", "path": caminho, "name": lido["name"] as? String ?? arquivo]
        }
        return nil
    }
}
