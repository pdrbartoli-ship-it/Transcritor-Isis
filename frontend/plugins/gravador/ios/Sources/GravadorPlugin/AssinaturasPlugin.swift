import Foundation
import UIKit
import StoreKit
import Capacitor

/// Abre a tela de assinaturas da Apple por cima do app, para trocar de plano ou
/// cancelar.
///
/// Existe porque o link da App Store (o `managementURL` do RevenueCat) não
/// mostra compras de TestFlight nem do ambiente de teste da Apple: abria uma
/// página dizendo que não havia assinatura nenhuma. É nesse ambiente que o
/// revisor da Apple testa, e ele veria a mesma página vazia ao tentar cancelar.
/// Esta tela é a que a Apple recomenda, mostra as compras de teste e as de
/// verdade, e a pessoa não sai do Dito.
///
/// O plugin do RevenueCat para Capacitor não tem esta chamada, por isso ela
/// mora aqui, no pacote que já está ligado ao projeto do iPhone.
@objc(AssinaturasPlugin)
public class AssinaturasPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AssinaturasPlugin"
    public let jsName = "Assinaturas"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "gerenciar", returnType: CAPPluginReturnPromise)
    ]

    /// Resolve quando a pessoa fecha a tela: é a hora de a página perguntar ao
    /// servidor se algo mudou.
    @objc func gerenciar(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let cena = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("Não foi possível abrir as assinaturas agora.")
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: cena)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}
