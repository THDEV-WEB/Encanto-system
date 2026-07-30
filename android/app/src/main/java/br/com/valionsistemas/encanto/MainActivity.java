package br.com.valionsistemas.encanto;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // REF-CAP-01 · Onda 4: NativePrintPlugin e' LOCAL (nao e' pacote npm) -> nao entra no scan automatico
    // de plugins do Capacitor (capacitor.plugins.json, gerado so' para @capacitor/app e @capacitor/browser
    // nesta REF); precisa de registerPlugin() explicito, ANTES de super.onCreate() (regra do Capacitor).
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
