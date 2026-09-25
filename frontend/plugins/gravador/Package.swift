// swift-tools-version: 5.9
import PackageDescription

// O nome do pacote é o que o `cap sync` deriva do nome do npm ("dito-gravador"
// vira "DitoGravador") e escreve no CapApp-SPM. Trocar um sem o outro quebra a
// montagem do iPhone.
let package = Package(
    name: "DitoGravador",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "DitoGravador",
            targets: ["GravadorPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "GravadorPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/GravadorPlugin")
    ]
)
