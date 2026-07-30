/* hooks/useCapacitorBackButton.js — REF-CAP-01 · Onda 4.
   Botao fisico "voltar" do Android: assim que existe QUALQUER listener de 'backButton', o Capacitor para
   de fazer sozinho o default (history.back() se houver, senao exitApp()) — a partir dai a decisao e' toda
   nossa. Sem isso, como o app nunca usa History API (SPA state-driven, sem router), o back button
   fecharia o app inteiro em qualquer tela, mesmo com um modal/carrinho/o Admin aberto.

   Prioridade de fechamento (mais recente/por cima primeiro):
   1. mode 'admin'/'login' -> volta pra loja (verLoja) em vez de sair do app;
   2. dentro da loja, fecha o que estiver aberto (modal/carrinho/fidelidade/menu — ver StoreApp.jsx,
      unico dono desse estado, exposto so' como resumo imperativo via ref);
   3. nada aberto -> sai do app (mesmo efeito do comportamento nativo default).

   Fora do Capacitor (navegador/PWA) e' no-op — Capacitor.isNativePlatform() nunca e' true la'. */
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

export function useCapacitorBackButton({ mode, verLoja, storeRef }) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle;
    CapacitorApp.addListener('backButton', () => {
      if (mode === 'admin' || mode === 'login') { verLoja(); return; }
      if (storeRef.current?.temAlgoAberto()) { storeRef.current.fecharTopo(); return; }
      CapacitorApp.exitApp();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [mode, verLoja, storeRef]);
}
