"""Etapa 0, parte 2 do plano "Perguntar ao acervo".

Acervo = 5 conversas: as 3 do teste-qualidade + 2 da conta de teste (uma aula em português e
um documentário em inglês). Perguntas = 23 da parte 1 + 20 novas (10 da aula, 10 do documentário).
Gabarito = intervalos de tempo (s), lidos à mão. Um trecho é "certo" se sobrepõe o intervalo.

Métodos:
  bm25        busca por palavra, só a pergunta (o piso medido na parte 1)
  planner     bm25 + palavras/sinônimos que a IA (Luna) devolve ao "entender a pergunta"
  planner+f   planner, restringindo às conversas que a IA apontou (quando aponta)
  oai         embeddings OpenAI text-embedding-3-small
  gemini      embeddings Gemini Embedding 2 (768 dims)
  hib-oai     RRF(planner, oai)     hib-gem  RRF(planner, gemini)     hib-3  RRF(planner, oai, gemini)
Tudo em cache (~/teste-recall/cache/) para repetir sem gastar de novo.
"""
import hashlib, json, math, os, re, sys
from concurrent.futures import ThreadPoolExecutor
import httpx
sys.path.insert(0, os.path.dirname(__file__))
import recall as R

HOME = os.path.expanduser('~/teste-recall')
CACHE = HOME + '/cache'; os.makedirs(CACHE, exist_ok=True)
CASOS = R.CASOS

def chaves():
    out = {}
    for ln in open(HOME + '/keys.env'):
        m = re.match(r'\s*([A-Z_]+)\s*[:=]\s*(\S+)', ln)
        if m: out[m.group(1)] = m.group(2)
    return out
K = chaves()
OPENAI = K.get('OPEN_AI_KEY') or K.get('OPENAI_API_KEY')
GEMINI = K.get('GEMINI_API_KEY')

def cached(nome, chave, fn):
    p = f"{CACHE}/{nome}-{hashlib.sha1(chave.encode()).hexdigest()[:16]}.json"
    if os.path.exists(p): return json.load(open(p))
    v = fn(); json.dump(v, open(p, 'w'), ensure_ascii=False); return v

gasto = {'planner_in': 0, 'planner_out': 0, 'oai_tok': 0, 'gem_chars': 0}

def trechos_de(segs, conv):
    out, buf, ini, fim = [], [], None, None
    for s in segs:
        if ini is None: ini = s['start']
        buf.append(s['text']); fim = s['end']
        if sum(len(x) + 1 for x in buf) >= R.ALVO_CHARS:
            out.append(dict(conv=conv, ini=ini, fim=fim, texto=' '.join(buf))); buf, ini = [], None
    if buf: out.append(dict(conv=conv, ini=ini, fim=fim, texto=' '.join(buf)))
    return out

def idioma(txt):
    w = re.findall(r'[a-z]+', R.norm(txt[:6000]))
    en = sum(w.count(x) for x in ('the', 'and', 'of', 'was', 'that', 'his'))
    pt = sum(w.count(x) for x in ('que', 'de', 'para', 'uma', 'com', 'nao'))
    return 'inglês' if en > pt else 'português'

def carregar():
    conv, T = [], []
    for c in ('audio-teste', 'gravacao-teste', 'slc-2t26'):
        d = json.load(open(f'{CASOS}/{c}/transcricao_backend.json'))
        conv.append(dict(id=c, titulo=d.get('title') or c, idioma=idioma(d['transcript']), dur=d['duration_s']))
        T += trechos_de(d['segments'], c)
    ac = json.load(open(HOME + '/acervo.json'))
    for slug, c in zip(('aula-energia', 'doc-google'), ac):
        conv.append(dict(id=slug, titulo=c['title'], idioma=idioma(c['transcript']), dur=c['duration_s']))
        T += trechos_de(c['segments'], slug)
    return conv, T

m = lambda a, b: a * 60 + b
# (conv, pergunta, [intervalos], sem_resposta, palavra-chave que confere o gabarito)
NOVAS = [
 ('aula-energia', "Quais são os substratos usados na via alática?", [(m(4,46), m(7,30))], False, r'fosfo|atp'),
 ('aula-energia', "Que exemplo de esporte a professora deu para a via aeróbia?", [(m(7,30), m(10,25))], False, r'maratona'),
 ('aula-energia', "O que é a fibra muscular tipo 1 e por que ela é vermelha?", [(m(13,0), m(16,30))], False, r'vermelh|mitocond'),
 ('aula-energia', "Que mito sobre gordura e carboidrato depois de 20 minutos foi desmentido?", [(m(21,29), m(24,56))], False, r'20 minutos|vinte|mito'),
 ('aula-energia', "Que exemplo foi usado para explicar a individualidade no treino e na nutrição?", [(m(26,38), m(28,21))], False, r'montanha'),
 ('aula-energia', "Em que intensidade a gordura predomina como combustível?", [(m(24,56), m(26,38))], False, r'gordura'),
 ('aula-energia', "Quanto tempo dá para sustentar a intensidade máxima?", [(m(16,30), m(20,20))], False, r'minuto'),
 ('aula-energia', "O que acontece com a via energética no exercício de baixa intensidade?", [(m(20,20), m(21,29))], False, r'baixa'),
 ('aula-energia', "Por que o futebol é exemplo de alternância entre as vias?", [(m(7,30), m(10,25))], False, r'futebol'),
 ('aula-energia', "Qual tipo de fibra a corrida de 100 metros usa?", [(m(10,25), m(13,0))], False, r'100'),
 ('doc-google', "Como funcionava o algoritmo PageRank?", [(395, 430)], False, r'rank'),
 ('doc-google', "Onde ficou o primeiro escritório do Google e o que tinha lá?", [(615, 660)], False, r'garage'),
 ('doc-google', "Quem foi contratado como CEO do Google?", [(850, 890)], False, r'schmidt'),
 ('doc-google', "Quanto o Google pagou pelo YouTube?", [(1340, 1375)], False, r'1\.65'),
 ('doc-google', "Quando o Gmail foi lançado e com quanto armazenamento?", [(1155, 1185)], False, r'gmail'),
 ('doc-google', "Quanto o Google pagou pelo Android e por que comprou?", [(1320, 1350)], False, r'android'),
 ('doc-google', "Por que o Google recusou a oferta de compra do Yahoo?", [(905, 935)], False, r'yahoo'),
 ('doc-google', "Qual é o valor de mercado do Google e da Alphabet?", [(940, 965)], False, r'market cap'),
 ('doc-google', "Onde nasceu Larry Page e o que os pais dele faziam?", [(195, 230)], False, r'michigan'),
 ('doc-google', "Quanto dinheiro os fundadores levantaram no começo?", [(600, 620)], False, r'million'),
]
GAB = [g for g in R.GAB] + [g[:4] for g in NOVAS]

SYS_PLANNER = """Você ajuda a buscar trechos em transcrições de conversas (reuniões, aulas, vídeos) de uma pessoa. Recebe a pergunta dela e a lista das conversas que ela tem (id, título, idioma do áudio, duração). Não responda à pergunta. Devolva SÓ um JSON:
{"palavras": [...], "conversas": [...], "recencia": null}
- palavras: de 6 a 14 palavras ou expressões curtas que provavelmente aparecem no trecho que responde à pergunta, escritas como seriam FALADAS: sinônimos, termos relacionados, siglas por extenso, grafias alternativas e prováveis erros de transcrição de nomes difíceis. Se a conversa provável estiver em outro idioma (veja a lista), escreva as palavras NESSE idioma.
- conversas: ids das conversas onde a resposta provavelmente está (todas as plausíveis; [] se não der para saber).
- recencia: número N se a pessoa pede "as últimas N", senão null."""

def planner(pergunta, conv):
    lista = '\n'.join(f"- {c['id']} | {c['titulo']} | áudio em {c['idioma']} | {c['dur']/60:.0f} min" for c in conv)
    user = f"Conversas:\n{lista}\n\nPergunta: {pergunta}"
    def chamar():
        r = httpx.post('https://api.openai.com/v1/chat/completions', headers={'Authorization': f'Bearer {OPENAI}'},
            json={'model': 'gpt-5.6-luna', 'reasoning_effort': 'low', 'max_completion_tokens': 2048,
                  'response_format': {'type': 'json_object'},
                  'messages': [{'role': 'system', 'content': SYS_PLANNER}, {'role': 'user', 'content': user}]}, timeout=90)
        if r.status_code != 200: raise RuntimeError(f'planner HTTP {r.status_code} {r.text[:160]}')
        j = r.json(); u = j['usage']
        return {'json': json.loads(j['choices'][0]['message']['content']), 'in': u['prompt_tokens'], 'out': u['completion_tokens']}
    v = cached('planner', SYS_PLANNER + user, chamar)
    gasto['planner_in'] += v['in']; gasto['planner_out'] += v['out']
    return v['json']

def emb_openai(textos):
    def chamar():
        out = []
        for i in range(0, len(textos), 64):
            r = httpx.post('https://api.openai.com/v1/embeddings', headers={'Authorization': f'Bearer {OPENAI}'},
                json={'model': 'text-embedding-3-small', 'input': textos[i:i+64]}, timeout=90)
            if r.status_code != 200: raise RuntimeError(f'openai emb HTTP {r.status_code} {r.text[:160]}')
            j = r.json(); gasto['oai_tok'] += j['usage']['total_tokens']
            out += [d['embedding'] for d in j['data']]
        return out
    return cached('oai', '\n'.join(textos), chamar)

def emb_gemini(textos):
    def chamar():
        out = []
        for i in range(0, len(textos), 50):
            reqs = [{'model': 'models/gemini-embedding-2', 'content': {'parts': [{'text': t}]}, 'output_dimensionality': 768} for t in textos[i:i+50]]
            r = httpx.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents',
                headers={'x-goog-api-key': GEMINI, 'Content-Type': 'application/json'}, json={'requests': reqs}, timeout=90)
            if r.status_code != 200: raise RuntimeError(f'gemini emb HTTP {r.status_code} {r.text[:200]}')
            gasto['gem_chars'] += sum(len(t) for t in textos[i:i+50])
            out += [e['values'] for e in r.json()['embeddings']]
        return out
    return cached('gem', '\n'.join(textos), chamar)

def cos(a, b):
    num = sum(x * y for x, y in zip(a, b)); da = math.sqrt(sum(x * x for x in a)); db = math.sqrt(sum(y * y for y in b))
    return num / (da * db) if da and db else 0.0

def rrf(listas, k=60):
    sc = {}
    for ordem in listas:
        for pos, i in enumerate(ordem): sc[i] = sc.get(i, 0) + 1 / (k + pos + 1)
    return sorted(sc, key=lambda i: -sc[i])

def main():
    conv, T = carregar()
    print(f'acervo: {len(conv)} conversas, {len(T)} trechos | perguntas: {len(GAB)}')
    for c, q, gold, _, kw in NOVAS:
        ok = any(re.search(kw, R.norm(t['texto'])) and t['conv'] == c and t['ini'] < g[1] and t['fim'] > g[0] for t in T for g in gold)
        if not ok: print('  AVISO gabarito sem a palavra-chave:', q)

    bm = R.BM25([R.tokens(t['texto'], True) for t in T])
    docs_oai = emb_openai([t['texto'] for t in T])
    docs_gem = emb_gemini([f"title: none | text: {t['texto']}" for t in T])
    perguntas = [g[1] for g in GAB]
    q_oai = emb_openai(perguntas)
    q_gem = emb_gemini([f'task: search result | query: {q}' for q in perguntas])
    with ThreadPoolExecutor(4) as ex: plans = list(ex.map(lambda q: planner(q, conv), perguntas))

    metodos = ['bm25', 'planner', 'planner+f', 'oai', 'gemini', 'hib-oai', 'hib-gem', 'hib-3']
    ranks = {mt: [] for mt in metodos}; ctx8 = {mt: [] for mt in metodos}
    plan_conv_ok = []
    for qi, (cv, q, gold, sem, *_) in enumerate(GAB):
        plan = plans[qi]
        palavras = ' '.join(plan.get('palavras') or [])
        alvo = set(plan.get('conversas') or [])
        plan_conv_ok.append((cv in alvo) if alvo else None)
        s_bm = bm.score(R.tokens(q, True))
        s_pl = bm.score(R.tokens(q + ' ' + palavras, True))
        s_pf = [s if (not alvo or T[i]['conv'] in alvo) else 0.0 for i, s in enumerate(s_pl)]
        s_oai = [cos(q_oai[qi], d) for d in docs_oai]
        s_gem = [cos(q_gem[qi], d) for d in docs_gem]
        ordem = lambda sc: sorted(range(len(T)), key=lambda i: -sc[i])
        o = {'bm25': ordem(s_bm), 'planner': ordem(s_pl), 'planner+f': ordem(s_pf), 'oai': ordem(s_oai), 'gemini': ordem(s_gem)}
        o['hib-oai'] = rrf([o['planner'], o['oai']]); o['hib-gem'] = rrf([o['planner'], o['gemini']]); o['hib-3'] = rrf([o['planner'], o['oai'], o['gemini']])
        certo = lambda i, g: T[i]['conv'] == cv and T[i]['ini'] < g[1] and T[i]['fim'] > g[0]
        for mt in metodos:
            rk = [next((k + 1 for k, i in enumerate(o[mt]) if certo(i, g)), None) for g in gold]
            ranks[mt].append(min([r for r in rk if r] or [10**9]))
            escolhidos, por = [], {}
            for i in o[mt]:
                if por.get(T[i]['conv'], 0) < 3: escolhidos.append(i); por[T[i]['conv']] = por.get(T[i]['conv'], 0) + 1
                if len(escolhidos) == 8: break
            ctx8[mt].append(any(certo(i, g) for i in escolhidos for g in gold))

    def linha(mt, idx):
        r = [ranks[mt][i] for i in idx]; n = len(idx)
        h = lambda k: sum(1 for v in r if v <= k)
        mrr = sum(1 / v for v in r if v < 10**9) / n
        c8 = sum(ctx8[mt][i] for i in idx)
        return f"{mt:<10} @1 {h(1):>2}/{n} ({100*h(1)/n:>3.0f}%) | @3 {h(3):>2} ({100*h(3)/n:>3.0f}%) | @5 {h(5):>2} | @10 {h(10):>2} ({100*h(10)/n:>3.0f}%) | MRR {mrr:.2f} | 8 enviados ao modelo: {c8}/{n} ({100*c8/n:>3.0f}%)"
    todas = list(range(len(GAB)))
    com_resp = [i for i in todas if not GAB[i][3]]
    ing = [i for i in todas if GAB[i][0] == 'doc-google']
    for nome, idx in [('TODAS', todas), ('só as com resposta no áudio', com_resp), ('as 10 do documentário em INGLÊS (perguntas em português)', ing)]:
        print(f'\n=== {nome} (n={len(idx)}) ===')
        for mt in metodos: print(linha(mt, idx))
    ok = [x for x in plan_conv_ok if x is not None]
    print(f"\nplanner apontou conversas em {len(ok)}/{len(plan_conv_ok)} perguntas; a conversa certa estava entre elas em {sum(ok)}/{len(ok)}")

    print('\n=== posição do 1º trecho certo: bm25 → planner → oai → gemini → hib-3 (— = fora do ranking) ===')
    for i, (cv, q, gold, sem, *_) in enumerate(GAB):
        f = lambda v: '—' if v >= 10**9 else str(v)
        pior = max(ranks[mt][i] for mt in metodos)
        if pior > 3 or sem:
            print(f"  {cv[:6]:<6} {'[sem resp]' if sem else '          '} {f(ranks['bm25'][i]):>3} → {f(ranks['planner'][i]):>3} → {f(ranks['oai'][i]):>3} → {f(ranks['gemini'][i]):>3} → {f(ranks['hib-3'][i]):>3} | {q[:70]}")
    print('\n=== exemplos do que a IA devolveu (planner) ===')
    for i in (23 + 1, 23 + 13, 23 + 15, 17):
        if i < len(GAB): print(' ', GAB[i][1][:60], '→', json.dumps(plans[i], ensure_ascii=False)[:280])
    usd = gasto['planner_in'] * 0.2e-6 + gasto['planner_out'] * 1.2e-6 + gasto['oai_tok'] * 0.02e-6 + gasto['gem_chars'] / 4 * 0.2e-6
    print(f"\nconsumo desta rodada (cache não conta): planner {gasto['planner_in']} in / {gasto['planner_out']} out, "
          f"OpenAI emb {gasto['oai_tok']} tok, Gemini emb ~{gasto['gem_chars']//4} tok → ~US$ {usd:.4f}")

if __name__ == '__main__':
    main()
