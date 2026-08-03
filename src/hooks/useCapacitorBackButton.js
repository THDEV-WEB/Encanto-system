/* hooks/useCapacitorBackButton.js — REF-CAP-01 · Onda 4.
   Botao fisico "voltar" do Android: assim que existe QUALQUER listener de 'backButton', o Capacitor para
   de fazer sozinho o default (history.back() se houver, senao exitApp()) — a partir dai a decisao e' toda
   nossa. Sem isso, como o app nunca usa History API (SPA state-driven, sem router), o back button
   fecharia o app inteiro em qualquer tela, mesmo com um modal/carrinho aberto.

   Prioridade de fechamento (mais recente/por cima primeiro):
   1. dentro da loja, fecha o que estiver aberto (modal/carrinho/fidelidade/menu — ver StoreApp.jsx,
      unico dono desse estado, exposto so' como resumo imperativo via ref);
   2. nada aberto -> sai do app (mesmo efeito do comportamento nativo default).

   REF-ADMIN-04 · Onda 4: o ramo "mode admin/login -> verLoja()" foi removido — o Admin nao vive mais
   neste bundle (app/dominio proprios, ver src/AdminApp.jsx), entao este back button nunca mais precisa
   decidir nada sobre ele.

   Fora do Capacitor (navegador/PWA) e' no-op — Capacitor.isNativePlatform() nunca e' true la'. */
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

export function useCapacitorBackButton({ storeRef }) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle;
    CapacitorApp.addListener('backButton', () => {
      if (storeRef.current?.temAlgoAberto()) { storeRef.current.fecharTopo(); return; }
      CapacitorApp.exitApp();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [storeRef]);
}
