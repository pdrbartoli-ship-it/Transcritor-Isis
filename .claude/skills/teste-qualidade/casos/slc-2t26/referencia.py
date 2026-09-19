# Referência real do teste de 2026-09-18/19 — teleconferência de resultados 2T26
# da SLC Agrícola (72 min). Guardada como exemplo de como uma referência preenchida
# fica; não precisa refazer para reusar este caso, só rodar `buscar` de novo se
# quiser a transcricao_backend.json (não foi versionada — vem de fora do repo).

DUR = 4319

GT_TURNOS = [
    (0, "andre"), (165, "pavinato"), (700, "ivo"), (960, "pavinato"), (1121, "andre"),
    (1175, "barra"), (1307, "pavinato"), (1700, "ivo"), (1826, "andre"), (1876, "palhares"),
    (1935, "pavinato"), (2050, "ivo"), (2132, "palhares"), (2180, "pavinato"), (2246, "andre"),
    (2270, "alencar"), (2392, "pavinato"), (2714, "andre"), (2740, "lucas"), (2799, "ivo"),
    (2943, "andre"), (2975, "henrique"), (3068, "pavinato"), (3240, "ivo"), (3417, "andre"),
    (3435, "mateus"), (3504, "ivo"), (3590, "pavinato"), (4017, "andre"), (4030, "gustavo"),
    (4124, "pavinato"), (4273, "andre"),
]

APELIDOS = {
    "andre": ["andre", "vasconcelos"], "pavinato": ["pavinato", "aurelio"], "ivo": ["ivo", "bruno"],
    "barra": ["barra", "gabriel"], "palhares": ["palhares", "guilherme"], "alencar": ["alencar", "leonardo"],
    "lucas": ["lucas", "ferreira"], "henrique": ["henrique", "brustolim"], "mateus": ["mateus", "enfeld"],
    "gustavo": ["gustavo", "troiano"],
}

# blocos de Q&A começam quando o moderador anuncia o analista, não quando ele
# começa a falar — corrigido depois da 1ª leitura (ver dito-troca-de-modelo)
GT_SECOES = [
    (0, 165, "Abertura", ["abertura", "orienta", "aviso", "instruc", "disclaimer", "tradu"]),
    (165, 530, "Mercado", ["mercado", "commodit", "algod", "soja", "milho", "preco"]),
    (530, 695, "Safra 25/26", ["safra", "produtiv", "colheita", "comercializ"]),
    (695, 960, "Financeiro", ["receita", "financeir", "ebitda", "resultado", "divida", "endivid", "capex", "terra"]),
    (960, 1121, "Safra 26/27 e ESG", ["26/27", "2627", "fertiliz", "insumo", "esg", "hedge", "sustentab", "premi"]),
    (1121, 1826, "Q&A Barra: El Niño e alavancagem", ["el nino", "clima", "alavanc", "barra"]),
    (1826, 2246, "Q&A Palhares: fertilizantes e dívida", ["fertiliz", "divida", "nitrog", "palhares"]),
    (2246, 2714, "Q&A Alencar: biodiesel e algodão", ["biodiesel", "b16", "biocombust", "alencar", "algod"]),
    (2714, 2943, "Q&A Lucas: capex 2027 e aquisições", ["capex", "aquisi", "radar", "irriga", "lucas", "investiment"]),
    (2943, 3417, "Q&A Henrique: produtividade e despesas", ["produtiv", "frete", "despesa", "custo", "tendencia", "henrique"]),
    (3417, 4017, "Q&A Mateus: área de soja, algodão, capex", ["area", "algod", "capex", "vale", "mateus"]),
    (4017, DUR, "Q&A Gustavo: terras e leaseback", ["terra", "propria", "arrend", "leaseback", "asset", "gustavo"]),
]
