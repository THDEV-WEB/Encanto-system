/* hooks/usePwaUpdate.js — REF-MOBILE-01 Onda 6.
   Registra o Service Worker (gerado por vite-plugin-pwa, ver vite.config.js) e expõe o aviso de "nova
   versão disponível" — nunca troca de versão sozinho (registerType:'prompt'), sempre com confirmação do
   usuário via a UI que consome este hook (evita um reload forçado no meio de um checkout).
   Mesmo padrão de degradação do resto do projeto (lib/supabase.js, lib/sentry.js): fora do browser, ou
   sem suporte a Service Worker, ou em dev (`vite dev`/`vite --mode e2e`, onde devOptions.enabled:false
   nunca gera o SW), tudo vira no-op — nunca bloqueia o boot. */
import { useEffect, useState, useCallback, useRef } from 'react';

export function usePwaUpdate() {
  const [novaVersaoDisponivel, setNovaVersaoDisponivel] = useState(false);
  const updateSWRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    let vivo = true;

    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (!vivo) return;
        updateSWRef.current = registerSW({
          onNeedRefresh() { if (vivo) setNovaVersaoDisponivel(true); },
          onOfflineReady() { try { console.log('[Encanto] pronto para uso offline'); } catch { /* noop */ } },
          onRegisterError(err) { try { console.warn('[Encanto] Service Worker erro:', err && err.message); } catch { /* noop */ } },
        });
      })
      .catch(() => { /* sem SW (dev, ou build sem o plugin) — app segue 100% igual */ });

    return () => { vivo = false; };
  }, []);

  const atualizar = useCallback(() => { updateSWRef.current?.(true); }, []);
  const dispensar = useCallback(() => setNovaVersaoDisponivel(false), []); // só esconde o aviso; o SW novo continua esperando e assume no próximo boot normal

  return { novaVersaoDisponivel, atualizar, dispensar };
}
