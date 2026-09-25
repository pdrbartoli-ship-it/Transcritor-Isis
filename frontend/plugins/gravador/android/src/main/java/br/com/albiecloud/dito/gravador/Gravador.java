package br.com.albiecloud.dito.gravador;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import com.getcapacitor.JSObject;

import java.io.File;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * A gravação em si, uma por processo. Só é tocada na thread principal.
 *
 * Mora fora do plugin e do serviço porque vive mais que os dois: o plugin
 * morre com a tela (tirar o app da lista de abertos) e o serviço só existe
 * enquanto grava, mas a gravação continua, e quem voltar precisa achá-la.
 *
 * O arquivo é AAC em quadros soltos (ADTS): cada quadro se sustenta sozinho,
 * então um processo morto no meio deixa um arquivo legível até o último
 * segundo gravado. Um .m4a só fica legível depois de fechado.
 */
final class Gravador {

    interface Ouvinte {
        void aoMudar(JSObject resumo);

        default void aoNivel(float nivel) {}
    }

    // Abaixo deste pico a gravação inteira foi silêncio (o microfone tomado
    // por uma ligação, por exemplo). Bem abaixo do rumor de qualquer sala.
    private static final float LIMIAR_SOM = 0.0003f;
    private static final long PASSO_MS = 100;
    private static final String PREFS = "dito_gravador";

    private static final Handler principal = new Handler(Looper.getMainLooper());
    private static final List<Ouvinte> ouvintes = new CopyOnWriteArrayList<>();
    private static final Runnable TIQUE = Gravador::tique;

    private static Context app;
    private static MediaRecorder gravador;
    private static String situacao = "parado"; // parado | gravando | pausado | encerrado
    private static String motivo;
    private static File arquivo;
    private static long acumuladoMs;
    private static long inicioTrecho; // 0 = pausado ou parado
    private static float pico;
    private static long maxMs;
    private static long ultimaPersistencia;
    private static boolean ligacaoAntes;
    private static boolean restaurado;

    private Gravador() {}

    static void adicionar(Ouvinte o) {
        if (!ouvintes.contains(o)) ouvintes.add(o);
    }

    static void remover(Ouvinte o) {
        ouvintes.remove(o);
    }

    static boolean ativo() {
        return "gravando".equals(situacao) || "pausado".equals(situacao);
    }

    static String situacao() {
        return situacao;
    }

    static String motivo() {
        return motivo;
    }

    static void iniciar(Context ctx, long teto) throws Exception {
        if (ativo()) throw new IllegalStateException("Já existe uma gravação em andamento.");
        app = ctx.getApplicationContext();
        apagarGravacoes();
        File pasta = new File(app.getFilesDir(), "gravacoes");
        //noinspection ResultOfMethodCallIgnored
        pasta.mkdirs();
        File f = new File(pasta, "gravacao-" + System.currentTimeMillis() + ".aac");

        MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(app) : new MediaRecorder();
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC);
            r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            // Fala não precisa de mais: o mesmo que o gravador da página usa.
            r.setAudioChannels(1);
            r.setAudioSamplingRate(16000);
            r.setAudioEncodingBitRate(32000);
            r.setOutputFile(f.getAbsolutePath());
            r.setOnErrorListener((mr, what, extra) -> finalizar("erro"));
            r.prepare();
            r.start();
        } catch (Exception e) {
            r.release();
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            throw e;
        }

        gravador = r;
        arquivo = f;
        situacao = "gravando";
        motivo = null;
        acumuladoMs = 0;
        inicioTrecho = SystemClock.elapsedRealtime();
        pico = 0;
        maxMs = teto;
        // Quem já está numa chamada de vídeo no celular e começa a gravar não
        // deve ver a gravação pausar logo de cara: só a MUDANÇA conta.
        ligacaoAntes = emLigacao();
        principal.removeCallbacks(TIQUE);
        principal.postDelayed(TIQUE, PASSO_MS);
        persistir();
        avisar();
    }

    static void pausar(String porque) {
        if (!"gravando".equals(situacao) || gravador == null) return;
        try {
            gravador.pause();
        } catch (Exception e) {
            finalizar("erro");
            return;
        }
        acumuladoMs = duracaoMs();
        inicioTrecho = 0;
        situacao = "pausado";
        motivo = porque;
        persistir();
        avisar();
    }

    static boolean retomar() {
        if (!"pausado".equals(situacao) || gravador == null) return "gravando".equals(situacao);
        try {
            gravador.resume();
        } catch (Exception e) {
            return false;
        }
        inicioTrecho = SystemClock.elapsedRealtime();
        situacao = "gravando";
        motivo = null;
        persistir();
        avisar();
        return true;
    }

    static void finalizar(String porque) {
        if (!ativo()) return;
        acumuladoMs = duracaoMs();
        inicioTrecho = 0;
        principal.removeCallbacks(TIQUE);
        MediaRecorder r = gravador;
        gravador = null;
        if (r != null) {
            try {
                r.stop();
            } catch (Exception ignorado) {
                // stop() reclama quando quase nada foi gravado. O arquivo ADTS
                // até ali continua legível, e é ele que vale.
            }
            r.release();
        }
        situacao = "encerrado";
        motivo = porque;
        persistir();
        avisar();
    }

    /** Apaga o arquivo de uma gravação já lida pelo app. Uma em andamento, não. */
    static void descartar() {
        if (ativo()) return;
        if (arquivo != null) {
            //noinspection ResultOfMethodCallIgnored
            arquivo.delete();
        }
        arquivo = null;
        situacao = "parado";
        motivo = null;
        acumuladoMs = 0;
        pico = 0;
        maxMs = 0;
        persistir();
    }

    static long duracaoMs() {
        return acumuladoMs + (inicioTrecho > 0 ? SystemClock.elapsedRealtime() - inicioTrecho : 0);
    }

    static JSObject resumo() {
        JSObject r = new JSObject();
        r.put("estado", situacao);
        r.put("duracaoMs", duracaoMs());
        r.put("teveSom", pico >= LIMIAR_SOM);
        r.put("mime", "audio/aac");
        if (arquivo != null) r.put("caminho", arquivo.getAbsolutePath());
        if (motivo != null) r.put("motivo", motivo);
        if (maxMs > 0) r.put("maxMs", maxMs);
        return r;
    }

    /**
     * Uma vez por processo. Se o salvo diz "gravando" e não há gravador vivo,
     * o processo morreu no meio: o arquivo até ali é o que sobrou, e o app
     * oferece transcrevê-lo.
     */
    static void restaurar(Context ctx) {
        if (restaurado) return;
        restaurado = true;
        if (app == null) app = ctx.getApplicationContext();
        if (gravador != null) return;
        SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String e = p.getString("estado", null);
        String c = p.getString("caminho", null);
        if (e == null || c == null || !new File(c).exists()) {
            p.edit().clear().apply();
            return;
        }
        arquivo = new File(c);
        acumuladoMs = p.getLong("duracaoMs", 0);
        pico = p.getFloat("pico", 1f);
        maxMs = p.getLong("maxMs", 0);
        situacao = "encerrado";
        motivo = ("gravando".equals(e) || "pausado".equals(e)) ? "interrompida" : p.getString("motivo", null);
        persistir();
    }

    private static void tique() {
        if (gravador == null) return;
        if ("gravando".equals(situacao)) {
            float nivel = 0;
            try {
                nivel = Math.min(1f, gravador.getMaxAmplitude() / 32767f);
            } catch (Exception ignorado) {
                // Sem nível a gravação segue; só a onda fica parada.
            }
            pico = Math.max(pico, nivel);
            for (Ouvinte o : ouvintes) o.aoNivel(nivel);
            if (maxMs > 0 && duracaoMs() >= maxMs) {
                finalizar("limite");
                return;
            }
        }

        // Numa ligação o Android dá o microfone a ela e os outros apps gravam
        // silêncio. Pausar deixa isso claro; ao fim dela, a gravação volta.
        // Perguntar o modo do áudio não pede permissão nenhuma, ao contrário
        // de ouvir o estado do telefone.
        boolean ligacao = emLigacao();
        if (ligacao && !ligacaoAntes && "gravando".equals(situacao)) {
            pausar("ligacao");
        } else if (!ligacao && ligacaoAntes && "pausado".equals(situacao) && "ligacao".equals(motivo)) {
            retomar();
        }
        ligacaoAntes = ligacao;

        if (SystemClock.elapsedRealtime() - ultimaPersistencia >= 2000) persistir();
        if (gravador != null) principal.postDelayed(TIQUE, PASSO_MS);
    }

    private static boolean emLigacao() {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return false;
        int m = am.getMode();
        return m == AudioManager.MODE_IN_CALL
            || m == AudioManager.MODE_IN_COMMUNICATION
            || (Build.VERSION.SDK_INT >= 30 && m == AudioManager.MODE_CALL_SCREENING);
    }

    private static void avisar() {
        JSObject r = resumo();
        for (Ouvinte o : ouvintes) o.aoMudar(r);
    }

    private static void persistir() {
        ultimaPersistencia = SystemClock.elapsedRealtime();
        if (app == null) return;
        SharedPreferences.Editor e = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if ("parado".equals(situacao) || arquivo == null) {
            e.clear().apply();
            return;
        }
        e.putString("estado", situacao)
            .putString("caminho", arquivo.getAbsolutePath())
            .putString("motivo", motivo)
            .putLong("duracaoMs", duracaoMs())
            .putFloat("pico", pico)
            .putLong("maxMs", maxMs)
            .apply();
    }

    private static void apagarGravacoes() {
        File[] itens = new File(app.getFilesDir(), "gravacoes").listFiles();
        if (itens == null) return;
        for (File f : itens) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }
}
