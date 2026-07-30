package br.com.valionsistemas.encanto;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * REF-CAP-01 · Onda 4 — plugin LOCAL (nao e' pacote npm; registrado a mao em MainActivity.java).
 *
 * Uma WebView "crua" (a base do Capacitor) nao liga window.print() a nenhum dialogo nativo — diferente
 * do app Chrome, que tem essa integracao propria por fora da API publica de WebView. A API oficial do
 * Android pra imprimir conteudo de WebView e' WebView.createPrintDocumentAdapter() + PrintManager
 * (developer.android.com/guide/topics/text/webview-printing), sempre disparada nativamente. Este plugin
 * carrega o HTML da comanda (ja pronto, vindo de comandaHtml.js) numa WebView TEMPORARIA e off-screen —
 * nunca a WebView principal do app (que teria o dashboard admin inteiro, nao a comanda) — replicando o
 * mesmo isolamento que o iframe oculto ja garante no navegador/PWA (ver printComanda.js).
 */
@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.isEmpty()) {
            call.reject("html vazio");
            return;
        }

        getActivity().runOnUiThread(() -> {
            WebView printWebView = new WebView(getActivity());
            printWebView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    if (printManager == null) {
                        call.reject("PrintManager indisponivel");
                        return;
                    }
                    String jobName = "Comanda Encanto";
                    PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                    printManager.print(jobName, adapter, new PrintAttributes.Builder().build());
                    call.resolve();
                }
            });
            printWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
