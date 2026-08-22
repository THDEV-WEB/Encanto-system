/* components/ui/CatalogSkeleton.jsx — REF-PERF-02.
   Placeholder do catalogo durante o loading inicial (StoreApp.jsx, catsVisiveis ainda carregando).
   Antes disso era so um <Spinner/> generico (~180px) que, ao ser substituido pela grade real de
   produtos (varias centenas de px), causava o maior salto de layout medido no Lighthouse mobile
   (CLS ~0.30, sozinho respondia por quase toda a nota). Reaproveita as MESMAS classes CSS da grade
   real (.products-section/.promo-banner/.products-grid/.product-card/.product-img/.product-info) —
   herda automaticamente colunas responsivas e alturas aproximadas, sem duplicar breakpoint nenhum.
   2 secoes falsas (nao 1): catalogo real tipicamente tem varias categorias visiveis de uma vez
   (medido no projeto E2E: 8 categorias cadastradas) — 1 secao so deixava a reserva de espaco curta
   demais, ainda sobrando parte do salto de layout. Puramente apresentacional (sem hooks/DS) -> entra
   no render.smoke. */
function SkelSection({ cards }) {
  return (
    <div className="products-section" aria-hidden="true">
      <div className="promo-banner skel-banner">
        <div className="skel-shimmer" style={{ height: 18, width: 140, borderRadius: 6 }} />
      </div>
      <div className="products-grid">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="product-card">
            <div className="product-img skel-shimmer" />
            <div className="product-info">
              <div className="skel-shimmer" style={{ height: 14, width: '85%', marginBottom: 6, borderRadius: 4 }} />
              <div className="skel-shimmer" style={{ height: 12, width: '60%', marginBottom: 10, borderRadius: 4 }} />
              <div className="skel-shimmer" style={{ height: 16, width: '40%', borderRadius: 4 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CatalogSkeleton() {
  return (
    <>
      <SkelSection cards={4} />
      <SkelSection cards={2} />
    </>
  );
}
