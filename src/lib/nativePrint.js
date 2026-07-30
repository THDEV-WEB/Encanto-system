/* lib/nativePrint.js — REF-CAP-01 · Onda 4.
   Ponte JS para o plugin nativo LOCAL NativePrintPlugin.java (android/app/.../NativePrintPlugin.java,
   registrado a mao em MainActivity.java — nao e' um pacote npm instalavel, so' existe dentro do projeto
   Android desta REF). `window.print()` (usado por components/admin/comanda/printComanda.js via iframe)
   nao aciona nenhum dialogo nativo de impressao dentro da WebView do Capacitor — diferente do Chrome, que
   tem essa integracao propria, uma WebView "crua" (a base do Capacitor) ignora window.print() em
   silencio. O plugin nativo carrega o HTML numa WebView temporaria propria e chama
   WebView.createPrintDocumentAdapter() + PrintManager (API oficial do Android p/ imprimir conteudo de
   WebView), preservando o mesmo isolamento que o iframe ja garantia no navegador/PWA. */
import { registerPlugin } from '@capacitor/core';

export const NativePrint = registerPlugin('NativePrint');
