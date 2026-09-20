"""Etapa 0 do plano "Perguntar ao acervo": a busca por palavra (BM25) acha o trecho certo?

Acervo = as 3 conversas do teste-qualidade (audio 5 min, consulta 8 min, teleconferência 72 min).
Gabarito = intervalos de tempo (segundos) lidos à mão em cada transcrição; um trecho é "certo" se
sobrepõe o intervalo. Sem chamada de API: mede só o piso (sem sinônimos da IA).
"""
import json, math, re, sys, unicodedata, glob, os
CASOS = '/workspaces/Transcritor-Isis/.claude/skills/teste-qualidade/casos'
ALVO_CHARS = 1400            # ~350 tokens, ~1,5 min de fala

def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')
STOP = set('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem e ou que qual quais quem quando onde como foi ser era sao e ao aos se ja mais muito nao sim tem ter vai vao esta estao pelo pela pelos pelas sobre segundo dele dela deles delas seu sua seus suas meu minha eu voce ela ele isso esse essa este esta aquele aquela entre ate depois antes so tambem mas'.split())

def tokens(s, stem):
    t = [w for w in re.findall(r'[a-z0-9]+', norm(s)) if w not in STOP and len(w) > 1]
    return [w[:6] for w in t] if stem else t

def trechos(caso, conv):
    d = json.load(open(f'{CASOS}/{caso}/transcricao_backend.json'))
    out, buf, ini, fim = [], [], None, None
    for s in d['segments']:
        if ini is None: ini = s['start']
        buf.append(s['text']); fim = s['end']
        if sum(len(x) + 1 for x in buf) >= ALVO_CHARS:
            out.append(dict(conv=conv, ini=ini, fim=fim, texto=' '.join(buf))); buf, ini = [], None
    if buf: out.append(dict(conv=conv, ini=ini, fim=fim, texto=' '.join(buf)))
    return out

class BM25:
    def __init__(s, docs, k1=1.2, b=0.75):
        s.docs = [d for d in docs]; s.k1, s.b = k1, b
        s.tf = [{} for _ in docs]
        for i, d in enumerate(docs):
            for w in d: s.tf[i][w] = s.tf[i].get(w, 0) + 1
        s.len = [len(d) for d in docs]; s.avg = sum(s.len) / len(docs)
        df = {}
        for t in s.tf:
            for w in t: df[w] = df.get(w, 0) + 1
        n = len(docs); s.idf = {w: math.log(1 + (n - f + .5) / (f + .5)) for w, f in df.items()}
    def score(s, q):
        r = []
        for i, t in enumerate(s.tf):
            sc = 0.0
            for w in set(q):
                f = t.get(w)
                if f: sc += s.idf[w] * f * (s.k1 + 1) / (f + s.k1 * (1 - s.b + s.b * s.len[i] / s.avg))
            r.append(sc)
        return r

m = lambda a, b: a * 60 + b   # mm:ss -> s
# (conv, pergunta, [intervalos certos], é_pergunta_sem_resposta_no_áudio)
GAB = [
 ('audio-teste',"Qual é o principal conselho que ela dá sobre o trabalho?",[(31,125)],False),
 ('audio-teste',"O que significa 'gambate', segundo o áudio?",[(62,100)],False),
 ('audio-teste',"Qual conquista do filho deixou a mãe tão feliz?",[(125,168)],False),
 ('audio-teste',"O que ela recomenda que ele faça além de trabalhar?",[(168,202)],False),
 ('audio-teste',"Quem é o Tadeu e o que ela exigiu dele?",[(202,265)],False),
 ('audio-teste',"Quem vai montar o projeto piloto e até quando?",[(265,296)],False),
 ('audio-teste',"Qual meta de vendas ela definiu para o Tadeu?",[(222,265)],True),
 ('audio-teste',"Qual é o assunto do primeiro curso dela?",[(200,225)],True),
 ('gravacao-teste',"Por que a paciente veio à consulta?",[(0,62)],False),
 ('gravacao-teste',"O que é a hipoglicemia reativa, segundo o médico?",[(60,96)],False),
 ('gravacao-teste',"Qual foi a pressão medida na consulta?",[(290,325)],False),
 ('gravacao-teste',"Que remédio de uso contínuo ela toma e em que dose?",[(180,230)],False),
 ('gravacao-teste',"Por que a filha acha que ela está ansiosa?",[(294,345)],False),
 ('gravacao-teste',"Quais exames o médico vai pedir?",[(325,370),(395,420)],False),
 ('gravacao-teste',"Qual foi o resultado do último exame de colesterol dela?",[(0,32)],True),
 ('gravacao-teste',"Que remédio o médico receitou para a dor de cabeça?",[(0,62)],True),
 ('slc-2t26',"Qual foi a receita líquida do semestre e quanto ela cresceu?",[(m(11,50),m(12,10))],False),
 ('slc-2t26',"O que a SLC está fazendo para se proteger do El Niño?",[(m(22,5),m(28,10))],False),
 ('slc-2t26',"Quem perguntou sobre biodiesel e o que a empresa respondeu?",[(m(38,20),m(41,0))],False),
 ('slc-2t26',"Qual é a meta de alavancagem da empresa e o mix de área própria versus arrendada?",[(m(28,15),m(30,30)),(m(67,40),m(71,30))],False),
 ('slc-2t26',"Quanto do nitrogênio da próxima safra já foi comprado?",[(m(33,0),m(34,40))],False),
 ('slc-2t26',"Qual foi o lucro líquido do trimestre?",[(m(11,55),m(12,25))],True),
 ('slc-2t26',"Quando a empresa vai divulgar a área plantada da próxima safra?",[(m(66,10),m(66,50))],False),
]

def rodar(stem, ruido):
    T = []
    for c in ('audio-teste', 'gravacao-teste', 'slc-2t26'): T += trechos(c, c)
    reais = len(T)
    if ruido:                                    # texto em português que NÃO é conversa: dilui o acervo
        for p in sorted(glob.glob('/workspaces/Transcritor-Isis/*.md')):
            txt = re.sub(r'\s+', ' ', open(p).read())
            for i in range(0, len(txt), ALVO_CHARS): T.append(dict(conv='ruido', ini=-1, fim=-1, texto=txt[i:i + ALVO_CHARS]))
    bm = BM25([tokens(t['texto'], stem) for t in T])
    res = []
    for conv, q, gold, sem_resp in GAB:
        sc = bm.score(tokens(q, stem))
        ordem = sorted(range(len(T)), key=lambda i: -sc[i])
        def certo(i, g): return T[i]['conv'] == conv and T[i]['ini'] < g[1] and T[i]['fim'] > g[0]
        ranks = []
        for g in gold:
            r = next((k + 1 for k, i in enumerate(ordem) if sc[i] > 0 and certo(i, g)), None)
            ranks.append(r)
        top1conv = T[ordem[0]]['conv'] == conv
        res.append(dict(q=q, conv=conv, ranks=ranks, sem_resp=sem_resp, top1conv=top1conv))
    return res, len(T), reais

def resumo(res, rotulo, so=None):
    r = [x for x in res if so is None or x['sem_resp'] == so]
    n = len(r)
    first = [min([k for k in x['ranks'] if k] or [10**9]) for x in r]      # 1º trecho certo (qualquer parte)
    allr = [max([k if k else 10**9 for k in x['ranks']]) for x in r]      # todas as partes
    h = lambda L, k: sum(1 for v in L if v <= k)
    mrr = sum(1 / v for v in first if v < 10**9) / n
    print(f"{rotulo:<34} n={n:>2} | hit@1 {h(first,1):>2} | @3 {h(first,3):>2} | @5 {h(first,5):>2} | @10 {h(first,10):>2} ({100*h(first,10)/n:>3.0f}%) | todas as partes @10 {h(allr,10):>2} | MRR {mrr:.2f} | conversa certa no 1º: {sum(x['top1conv'] for x in r)}/{n}")

if __name__ == '__main__':
    for stem in (False, True):
        for ruido in (False, True):
            res, ntot, nreais = rodar(stem, ruido)
            print(f"\n== {'prefixo-6 (stemming simples)' if stem else 'palavra inteira'} | {'com ruído' if ruido else 'só as 3 conversas'} | {ntot} trechos ({nreais} de conversa)")
            resumo(res, 'perguntas com resposta no áudio', False)
            resumo(res, 'perguntas SEM resposta (armadilha)', True)
            resumo(res, 'todas as 23')
            if stem and not ruido:
                print('\nDetalhe (prefixo-6, só as 3 conversas): posição do 1º trecho certo (None = fora do ranking)')
                for x in res:
                    print(f"  {'[sem resp] ' if x['sem_resp'] else '           '}{x['ranks']!s:<14} {x['conv'][:5]} | {x['q']}")
