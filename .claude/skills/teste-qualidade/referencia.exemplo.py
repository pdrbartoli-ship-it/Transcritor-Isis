# Modelo de casos/<slug>/referencia.py — copie e preencha lendo o vídeo/transcrição
# inteiro. É o passo mais lento do teste e o que dá credibilidade ao resto: um erro
# aqui pontua todo mundo errado do mesmo jeito, então vale conferir os tempos duas vezes.

DUR = 0  # duração total em segundos (confira em transcricao_backend.json -> duration_s)

# Quem está falando a cada trecho. Uma entrada por TROCA de locutor (não por frase);
# interjeições de 1-2s ("pode falar", "obrigado") não precisam de entrada própria.
# Segundos, e uma chave curta por pessoa (vai bater com APELIDOS abaixo).
GT_TURNOS = [
    (0, "apresentador"),
    # (123, "convidado1"),
]

# Formas de escrever/chamar cada pessoa, pra reconhecer o "speaker" que o modelo
# devolveu mesmo quando ele usa nome completo, primeiro nome ou sobrenome.
APELIDOS = {
    "apresentador": ["fulano", "sobrenome"],
    # "convidado1": ["ciclano"],
}

# O que estava sendo discutido em cada trecho, e palavras (em minúsculo, sem acento)
# que um capítulo certo teria de conter no título ou nos bullets. Cubra a reunião
# inteira sem buraco: do fim de uma seção ao início da próxima.
GT_SECOES = [
    (0, 60, "Abertura", ["abertura", "introducao"]),
    # (60, 300, "Nome do assunto", ["palavra1", "palavra2"]),
]
