/* components/ui/LazySection.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx). Ajustado na REF-PERF-05.
   Renderiza os children so quando a secao entra (ou esta perto de) o viewport (IntersectionObserver).
   Browser-heavy -> validado por SMOKE MANUAL/dev (fora do render.smoke automatizado, conforme plano R9).

   REF-PERF-05 (achado da auditoria de CLS residual): a checagem de geometria rodava em useEffect, que o
   navegador so executa DEPOIS do 1o paint -- toda secao perto do topo (a maioria, dado o rootMargin
   generoso de +400px) SEMPRE pintava o placeholder de minHeight:240px 1x, so' pra trocar pelo conteudo
   real (250-700+px reais, por categoria) no frame seguinte. Com varias secoes proximas do topo trocando
   de altura quase juntas, o salto medido (via PerformanceObserver) chegava a empurrar conteudo bem
   abaixo na pagina (ex.: o rodape ValionCredit) em ate ~0,36 de CLS sozinho -- mecanismo confirmado,
   nao apenas suspeito. useLayoutEffect roda SINCRONO logo apos o DOM commitar, ANTES do navegador
   pintar -- pra secoes ja dentro do threshold, o usuario (e o Lighthouse) nunca chega a ver o
   placeholder: o conteudo real ja sai no 1o paint. Secoes genuinamente abaixo da dobra continuam
   exatamente como antes (IntersectionObserver assincrono, disparado por scroll do usuario -- sem
   relacao com CLS de carregamento inicial). */
import React from 'react';
export const LazySection = React.memo(function LazySection({ id, children, style }) {
  const [visible, setVisible] = React.useState(false);
  const ref = React.useRef(null);
  React.useLayoutEffect(()=>{
    if (!ref.current) return;
    /* Se já está no viewport (ex: seção do topo), renderizar imediatamente */
    const rect = ref.current.getBoundingClientRect();
    if (rect.top < window.innerHeight + 400) { setVisible(true); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px 0px' } /* pré-carregar 200px antes de aparecer */
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} id={id} style={{scrollMarginTop: style?.scrollMarginTop || 24, ...style}}>
      {visible ? children : (
        <div style={{minHeight:240,background:'transparent'}}/>
      )}
    </div>
  );
});
