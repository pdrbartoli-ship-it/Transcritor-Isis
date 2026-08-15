package br.com.albiecloud.dito;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Precisa vir antes do super: o bridge carrega os plugins registrados
        // durante o onCreate, e o conteúdo compartilhado é lido já no load().
        registerPlugin(SharedContentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
