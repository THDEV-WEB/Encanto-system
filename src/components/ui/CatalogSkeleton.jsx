/* components/ui/CatalogSkeleton.jsx — REF-PERF-02 (ajustado na REF-PERF-04).
   Placeholder do catalogo durante o loading inicial (StoreApp.jsx, catsVisiveis ainda carregando).
   Antes disso era so um <Spinner/> generico (~180px) que, ao ser substituido pela grade real de
   produtos (varias centenas de px), causava o maior salto de layout medido no Lighthouse mobile
   (CLS ~0.30, sozinho respondia por quase toda a nota). Reaproveita as MESMAS classes CSS da grade
   real (.products-section/.promo-banner/.products-grid/.product-card/.product-img/.product-info) —
   herda automaticamente colunas responsivas e alturas aproximadas, sem duplicar breakpoint nenhum.

   3 secoes falsas (era 2 na REF-PERF-02): catalogo real tem hoje 8 categorias cadastradas (medido no
   projeto E2E) — mesmo 2 secoes ainda deixava a reserva de espaco visivelmente curta pra 8 secoes
   reais, sobrando parte do salto de layout na troca skeleton -> grade real (achado da auditoria
   REF-PERF-04). NAO subiu para 8 secoes cheias de proposito: sem um 2o fetch (fora de escopo —
   contaria quantas categorias existem so' depois de ja ter os dados, o que reintroduziria a espera que
   a REF-PERF-03 eliminou) nao ha como saber a contagem real ANTES do skeleton renderizar, e 8 secoes
   com grade de cards cada uma pesaria demais no 1o paint (o oposto do que este componente existe pra
   resolver). 3 e' um meio-termo deterministico e estatico: reduz a MAGNITUDE do salto restante sem
   inflar artificialmente o conteudo nem atrasar a percepcao da pagina. Puramente apresentacional (sem
   hooks/DS) -> entra no render.smoke. */
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
      <SkelSection cards={2} />
    </>
  );
}
