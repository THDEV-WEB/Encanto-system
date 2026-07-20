/* components/admin/comanda/printComanda.js — REF-ORDER-01 · Parte 1.
   UNICO ponto IMPURO da comanda (efeito de DOM/print). Imprime o HTML autocontido via IFRAME OCULTO
   (nao window.open -> imune a bloqueador de pop-up) e limpa apos imprimir. Isolado de proposito para
   que comandaModel/comandaHtml permanecam 100% puros/testaveis. No-op seguro fora do browser. */

export function printComanda(html) {
  if (typeof document === 'undefined') return false;   // SSR / Node -> no-op
  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    iframe.srcdoc = html;

    let limpo = false;
    const limpar = () => {
      if (limpo) return;
      limpo = true;
      // pequeno atraso: alguns navegadores disparam onafterprint antes de terminar o spool
      setTimeout(() => { try { iframe.remove(); } catch { /* noop */ } }, 500);
    };

    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) { limpar(); return; }
        try { win.onafterprint = limpar; } catch { /* noop */ }
        win.focus();
        win.print();
      } catch { /* noop */ }
      // fallback de limpeza caso onafterprint nao dispare (ex.: cancelamento)
      setTimeout(limpar, 60000);
    };

    document.body.appendChild(iframe);
    return true;
  } catch {
    return false;
  }
}
