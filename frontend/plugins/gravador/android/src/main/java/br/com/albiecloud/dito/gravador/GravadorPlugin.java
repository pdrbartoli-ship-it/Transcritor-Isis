package br.com.albiecloud.dito.gravador;

import android.Manifest;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * A ponte entre a página e o gravador nativo (Gravador + GravadorService).
 * O mesmo contrato do plugin do iPhone: iniciar, pausar, retomar, encerrar,
 * estado e descartar; eventos "mudou" e "nivel".
 */
@CapacitorPlugin(
    name = "GravadorNativo",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microfone"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notificacoes")
    }
)
public class GravadorPlugin extends Plugin implements Gravador.Ouvinte {

    private final Handler principal = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        principal.post(() -> {
            Gravador.restaurar(getContext());
            Gravador.adicionar(this);
        });
    }

    @Override
    protected void handleOnDestroy() {
        principal.post(() -> Gravador.remover(this));
    }

    @PluginMethod
    public void iniciar(PluginCall call) {
        if (getPermissionState("microfone") != PermissionState.GRANTED) {
            // A notificação é o controle de fora do app; sem ela a gravação
            // continua, só que sem os botões. Por isso não é obrigatória.
            String[] pedir = Build.VERSION.SDK_INT >= 33
                ? new String[] { "microfone", "notificacoes" }
                : new String[] { "microfone" };
            requestPermissionForAliases(pedir, call, "aposPermissao");
            return;
        }
        comecar(call);
    }

    @PermissionCallback
    private void aposPermissao(PluginCall call) {
        if (getPermissionState("microfone") != PermissionState.GRANTED) {
            call.reject("Acesso ao microfone negado. Autorize o microfone do Dito nas configurações do Android e tente de novo.", "SEM_PERMISSAO");
            return;
        }
        comecar(call);
    }

    private void comecar(PluginCall call) {
        Double max = call.getDouble("maxSegundos");
        long teto = max != null && max > 0 ? (long) (max * 1000) : 0;
        principal.post(() -> {
            try {
                Gravador.iniciar(getContext(), teto);
            } catch (IllegalStateException e) {
                call.reject(e.getMessage(), "EM_ANDAMENTO");
                return;
            } catch (Exception e) {
                call.reject("Não foi possível iniciar a gravação. Confira se outro app não está usando o microfone.", "FALHOU", e);
                return;
            }
            try {
                GravadorService.iniciar(getContext());
            } catch (Exception e) {
                // Sem o serviço a gravação continua, mas só com o app aberto.
            }
            call.resolve(Gravador.resumo());
        });
    }

    @PluginMethod
    public void pausar(PluginCall call) {
        principal.post(() -> {
            Gravador.pausar(null);
            call.resolve(Gravador.resumo());
        });
    }

    @PluginMethod
    public void retomar(PluginCall call) {
        principal.post(() -> {
            if (!Gravador.retomar()) {
                call.reject("Não foi possível retomar a gravação.");
                return;
            }
            call.resolve(Gravador.resumo());
        });
    }

    @PluginMethod
    public void encerrar(PluginCall call) {
        principal.post(() -> {
            Gravador.finalizar("voce");
            if (!"encerrado".equals(Gravador.situacao())) {
                call.reject("Não há gravação para encerrar.");
                return;
            }
            call.resolve(Gravador.resumo());
        });
    }

    @PluginMethod
    public void estado(PluginCall call) {
        principal.post(() -> {
            Gravador.restaurar(getContext());
            call.resolve(Gravador.resumo());
        });
    }

    @PluginMethod
    public void descartar(PluginCall call) {
        principal.post(() -> {
            Gravador.descartar();
            call.resolve(Gravador.resumo());
        });
    }

    @Override
    public void aoMudar(JSObject resumo) {
        notifyListeners("mudou", resumo);
    }

    @Override
    public void aoNivel(float nivel) {
        // Com o app fora da tela ninguém vê a onda, e os eventos só se
        // acumulariam no WebView parado.
        if (getBridge() == null || !getBridge().getApp().isActive()) return;
        JSObject d = new JSObject();
        d.put("nivel", nivel);
        notifyListeners("nivel", d);
    }
}
