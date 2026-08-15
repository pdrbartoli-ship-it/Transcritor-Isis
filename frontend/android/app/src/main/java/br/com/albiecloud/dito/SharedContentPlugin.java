package br.com.albiecloud.dito;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Recebe o que outros apps compartilham com o Dito (ACTION_SEND).
 *
 * Dois casos, que chegam de formas diferentes:
 *  - áudio/vídeo (ex.: WhatsApp) vem como EXTRA_STREAM, uma Uri content://
 *    com permissão de leitura TEMPORÁRIA, válida só enquanto este intent
 *    estiver sendo tratado. Por isso copiamos o arquivo para o cache na hora;
 *    tentar lê-lo depois, do lado do JS, falharia.
 *  - link (ex.: YouTube) vem como EXTRA_TEXT, texto puro. Não há arquivo.
 *
 * O conteúdo fica guardado até o JS chamar consume(), porque o intent pode
 * chegar antes de a interface estar pronta para tratá-lo.
 */
@CapacitorPlugin(name = "SharedContent")
public class SharedContentPlugin extends Plugin {

    private JSObject pending;

    @Override
    public void load() {
        // App aberto pelo compartilhamento: o intent já está na activity.
        capture(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        // App já estava aberto: o intent chega por aqui, e avisamos o JS na
        // hora, já que ele não vai remontar para chamar consume() sozinho.
        capture(intent);
        if (pending != null) {
            notifyListeners("sharedContent", pending);
        }
    }

    /** Entrega o conteúdo pendente e o descarta, para não reprocessar. */
    @PluginMethod
    public void consume(PluginCall call) {
        JSObject result = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(result);
    }

    private void capture(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null) return;

        if (type.startsWith("text/")) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (TextUtils.isEmpty(text)) return;
            JSObject shared = new JSObject();
            shared.put("type", "text");
            shared.put("value", text.trim());
            pending = shared;
            // A activity pode ser recriada (girar a tela, por exemplo) com o
            // mesmo intent; sem limpar, o conteúdo seria processado de novo.
            intent.removeExtra(Intent.EXTRA_TEXT);
            return;
        }

        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        try {
            String name = displayName(uri);
            JSObject shared = new JSObject();
            shared.put("type", "file");
            shared.put("path", copyToCache(uri, name));
            shared.put("name", name);
            pending = shared;
            intent.removeExtra(Intent.EXTRA_STREAM);
        } catch (Exception e) {
            // Sem conseguir ler o arquivo não há o que processar; o app abre
            // normalmente, em vez de quebrar na inicialização.
        }
    }

    /** Nome original do arquivo, para a fonte não se chamar "content://...". */
    private String displayName(Uri uri) {
        String name = null;
        try (Cursor cursor = getContext().getContentResolver()
                .query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Alguns provedores não expõem o nome; usamos o genérico abaixo.
        }
        if (TextUtils.isEmpty(name)) name = "audio-compartilhado";
        return name.replaceAll("[/\\\\]", "_");
    }

    private String copyToCache(Uri uri, String name) throws Exception {
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cache indisponível");
        // O prefixo de tempo evita que dois compartilhamentos com o mesmo nome
        // (comum em áudio de WhatsApp) se sobrescrevam.
        File dest = new File(dir, System.currentTimeMillis() + "-" + name);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(dest)) {
            if (in == null) throw new IllegalStateException("não foi possível abrir o arquivo");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        }
        return dest.getAbsolutePath();
    }
}
