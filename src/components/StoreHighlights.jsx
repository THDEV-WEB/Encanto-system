/* components/StoreHighlights.jsx — REF-UI-TOPBAR-01.
   Substitui o antigo banner promocional (.hero) por CHIPS de "quick info" no idioma dos apps de delivery:
   leves, horizontais, pouca altura, cantos arredondados, alta legibilidade. Mantem SO os diferenciais da
   loja — estrelas "Entrega Rapida" (informativo) e "Programa Fidelidade" (acao: preserva EXATAMENTE o
   onClick do botao antigo do banner, inclusive o estado de recompensa). Apresentacional puro (sem hooks/
   DS/browser) -> entra no render.smoke. O protagonista da tela volta a ser o catalogo. */
import React from 'react';

/* estrela cheia — mesmo path do antigo badge do banner (identidade preservada) */
const Estrela = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
);

export function StoreHighlights({ loyaltyReward = false, onLoyalty }) {
  return (
    <div className="store-chips">
      {/* diferencial 1 — avaliacao/entrega (informativo, nao clicavel) */}
      <div className="store-chip store-chip--stars">
        <span className="store-chip-stars" aria-hidden="true">
          {[1,2,3,4,5].map(i => <Estrela key={i} />)}
        </span>
        <span className="store-chip-label">Entrega Rápida</span>
      </div>
      {/* diferencial 2 — fidelidade (acao preservada do banner; realce dourado quando ha recompensa) */}
      <button
        type="button"
        className={'store-chip store-chip--loyalty' + (loyaltyReward ? ' store-chip--reward' : '')}
        onClick={onLoyalty}
      >
        <span className="store-chip-ico" aria-hidden="true">🎁</span>
        <span className="store-chip-label">{loyaltyReward ? 'Recompensa disponível!' : 'Programa Fidelidade'}</span>
      </button>
    </div>
  );
}
