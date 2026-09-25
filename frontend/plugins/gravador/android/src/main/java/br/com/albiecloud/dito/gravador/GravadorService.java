package br.com.albiecloud.dito.gravador;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

/**
 * O serviço em primeiro plano da gravação, e a notificação fixa dela.
 *
 * O Android corta o microfone de app em segundo plano. Um serviço do tipo
 * microfone, com a notificação à vista, é o jeito aceito de continuar
 * gravando com a tela travada ou em outro app. A notificação é também o
 * controle de fora do app: o cronômetro, Pausar/Retomar e Encerrar.
 */
public class GravadorService extends Service implements Gravador.Ouvinte {

    static final String MOSTRAR = "br.com.albiecloud.dito.gravador.MOSTRAR";
    static final String PAUSAR = "br.com.albiecloud.dito.gravador.PAUSAR";
    static final String RETOMAR = "br.com.albiecloud.dito.gravador.RETOMAR";
    static final String ENCERRAR = "br.com.albiecloud.dito.gravador.ENCERRAR";

    private static final String CANAL = "gravacao";
    private static final int ID_GRAVANDO = 7301;
    private static final int ID_ENCERRADA = 7302;

    private boolean emPrimeiroPlano;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        criarCanal();
        Gravador.adicionar(this);
    }

    @Override
    public void onDestroy() {
        Gravador.remover(this);
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Primeiro o primeiro plano, sempre: quem foi iniciado com
        // startForegroundService e sai sem chamar startForeground derruba o app.
        if (!emPrimeiroPlano) {
            try {
                int tipo = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
                ServiceCompat.startForeground(this, ID_GRAVANDO, montar(), tipo);
                emPrimeiroPlano = true;
            } catch (Exception e) {
                // Sem primeiro plano a gravação continua, mas só com o app aberto.
            }
        }

        String acao = intent != null ? intent.getAction() : null;
        if (PAUSAR.equals(acao)) {
            Gravador.pausar(null);
        } else if (RETOMAR.equals(acao)) {
            Gravador.retomar();
        } else if (ENCERRAR.equals(acao)) {
            Gravador.finalizar("fora");
        }

        if (!Gravador.ativo()) sair();
        return START_NOT_STICKY;
    }

    @Override
    public void aoMudar(JSObject resumo) {
        if (Gravador.ativo()) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(ID_GRAVANDO, montar());
            return;
        }
        String motivo = resumo.getString("motivo");
        // Encerrada de fora do app (pelo botão da notificação, pelo fim do
        // saldo ou por uma falha): quem estava fora precisa saber que acabou e
        // que o áudio está esperando. Quem encerrou no próprio app já vê isso.
        if ("fora".equals(motivo) || "limite".equals(motivo) || "erro".equals(motivo)) {
            mostrarEncerrada(motivo, resumo.optLong("duracaoMs"));
        }
        sair();
    }

    private void sair() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        emPrimeiroPlano = false;
        stopSelf();
    }

    private Notification montar() {
        boolean pausado = "pausado".equals(Gravador.situacao());
        long ms = Gravador.duracaoMs();
        String titulo;
        if (!pausado) titulo = "Gravando";
        else if ("ligacao".equals(Gravador.motivo())) titulo = "Pausada pela ligação";
        else titulo = "Gravação pausada";

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(icone())
            .setContentTitle(titulo)
            .setContentText(pausado ? "Parada em " + relogio(ms) + " · toque para abrir o Dito" : "Toque para abrir o Dito")
            .setContentIntent(abrirApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            // O cronômetro é do próprio sistema: continua certo com o app
            // congelado, sem atualizar a notificação a cada segundo.
            .setShowWhen(!pausado)
            .setUsesChronometer(!pausado)
            .setWhen(System.currentTimeMillis() - ms)
            .addAction(0, pausado ? "Retomar" : "Pausar", acao(pausado ? RETOMAR : PAUSAR, 1))
            .addAction(0, "Encerrar", acao(ENCERRAR, 2));
        Integer cor = cor();
        if (cor != null) b.setColor(cor);
        return b.build();
    }

    private void mostrarEncerrada(String motivo, long ms) {
        String titulo;
        String texto;
        if ("limite".equals(motivo)) {
            titulo = "Gravação encerrada · " + duracaoCurta(ms);
            texto = "Seus minutos do mês acabaram. Toque para transcrever o que foi gravado.";
        } else if ("erro".equals(motivo)) {
            titulo = "A gravação parou · " + duracaoCurta(ms);
            texto = "O que foi gravado está guardado. Toque para transcrever.";
        } else {
            titulo = "Gravação encerrada · " + duracaoCurta(ms);
            texto = "Toque para transcrever";
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(icone())
            .setContentTitle(titulo)
            .setContentText(texto)
            .setContentIntent(abrirApp())
            .setAutoCancel(true)
            .setSilent(true);
        Integer cor = cor();
        if (cor != null) b.setColor(cor);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(ID_ENCERRADA, b.build());
    }

    private PendingIntent abrirApp() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent();
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent acao(String acao, int codigo) {
        Intent i = new Intent(this, GravadorService.class).setAction(acao);
        return PendingIntent.getService(this, codigo, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // O ícone e a cor são os da notificação do convite, que moram no app, e não
    // aqui: procurados pelo nome, com o do sistema de reserva.
    private int icone() {
        int id = getResources().getIdentifier("ic_notificacao", "drawable", getPackageName());
        return id != 0 ? id : android.R.drawable.ic_btn_speak_now;
    }

    private Integer cor() {
        int id = getResources().getIdentifier("notificacao", "color", getPackageName());
        return id != 0 ? ContextCompat.getColor(this, id) : null;
    }

    private void criarCanal() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CANAL) != null) return;
        // Importância baixa: fica na barra, sem som e sem saltar na tela.
        NotificationChannel canal = new NotificationChannel(CANAL, "Gravação", NotificationManager.IMPORTANCE_LOW);
        canal.setShowBadge(false);
        nm.createNotificationChannel(canal);
    }

    private static String relogio(long ms) {
        long s = ms / 1000;
        long h = s / 3600;
        long m = (s % 3600) / 60;
        long seg = s % 60;
        return h > 0 ? String.format("%d:%02d:%02d", h, m, seg) : String.format("%d:%02d", m, seg);
    }

    private static String duracaoCurta(long ms) {
        long s = ms / 1000;
        return s < 60 ? s + " s" : (s / 60) + " min";
    }

    static void iniciar(Context ctx) {
        Intent i = new Intent(ctx, GravadorService.class).setAction(MOSTRAR);
        ContextCompat.startForegroundService(ctx, i);
    }
}
