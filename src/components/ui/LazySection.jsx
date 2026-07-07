/* components/ui/LazySection.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx).
   Renderiza os children so quando a secao entra (ou esta perto de) o viewport (IntersectionObserver).
   Browser-heavy -> validado por SMOKE MANUAL/dev (fora do render.smoke automatizado, conforme plano R9). */
import React from 'react';
export const LazySection = React.memo(function LazySection({ id, children, style }) {
  const [visible, setVisible] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(()=>{
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
