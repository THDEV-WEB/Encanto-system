/* components/ProductCard.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx).
   Card de produto. React.memo cujo comparador COMPARA preço/tamanhos (PRICE-DOMAIN-01): uma
   alteração de preco/preco_promo/tamanhos passa a re-renderizar o card, eliminando a staleness
   visual (antes o comparador ignorava preço de propósito).
   Consumidor de domínio (utils/pricing) → allowlist D1 do test:deps. BADGE_MAP movido junto (privado). */
import React from 'react';
import { emPromocao, precoVitrine } from '../utils/pricing.js';
import { fmt, precoApartir } from '../utils/format.js';
import { catEmoji, isHttpUrl } from '../utils/catalog.js';

/* Mapa badge → estilo */
const BADGE_MAP = {
  'mais_vendido': {cls:'badge-mais-vendido', txt:'⭐ Mais vendido'},
  'favorito':     {cls:'badge-favorito',     txt:'💜 Favorito'},
  'novo':         {cls:'badge-novo',         txt:'✨ Novo'},
  'promocao':     {cls:'badge-promocao',     txt:'🔥 Promoção'},
};

export const ProductCard = React.memo(function ProductCard({ prod, catNome, onOpen }) {
  const promo = emPromocao(prod);
  const badge = prod.badge ? BADGE_MAP[prod.badge] : null;
  const temTamanhos = Array.isArray(prod.tamanhos) && prod.tamanhos.length>0;
  // Valida URL: aceita apenas http/https, nunca base64 ou string vazia
  const hasValidImg = isHttpUrl(prod.imagem_url);
  return (
    <div className="product-card" data-prod={prod.id} onClick={()=>{console.log('[ENCANTO] Card clicado:', prod.id, prod.nome); onOpen(prod);}}>
      <div className="product-img">
        {hasValidImg && (
          <>
            {/* REF-IMG-01: backdrop borrado (mesma imagem em COVER) preenche as bordas quando a imagem
                principal (contain) nao cobre 100% -> nada de faixa vazia feia. Mesmo src => reutiliza o
                cache do browser (1 request). aria-hidden: puramente decorativo. */}
            <img className="product-img-bg" src={prod.imagem_url} alt="" aria-hidden="true" loading="lazy"
              onError={e=>{ e.target.style.display='none'; }}/>
            {/* Imagem principal: INTEIRA (object-fit:contain no CSS), centralizada, sem corte/distorcao.
                Fade-in por opacity (transicao no CSS, para nao anular o transform do hover). */}
            <img className="product-img-main" src={prod.imagem_url} alt={prod.nome} loading="lazy"
              style={{opacity:0}}
              onLoad={e=>{ e.target.style.opacity='1'; }}
              onError={e=>{
                const box=e.target.closest('.product-img');
                if(box){ box.querySelectorAll('img').forEach(im=>{ im.style.display='none'; });
                  const ph=box.querySelector('.product-img-placeholder'); if(ph) ph.style.display='flex'; }
              }}/>
          </>
        )}
        {/* Placeholder — visível quando sem imagem ou imagem com erro */}
        <div className="product-img-placeholder" style={{display: hasValidImg ? 'none' : 'flex'}}>
          {catEmoji(catNome||prod.nome)}
        </div>
        {badge && <span className={`product-badge ${badge.cls}`}>{badge.txt}</span>}
        {!badge && promo && <span className="promo-tag">PROMO</span>}
        {!prod.disponivel && <div className="unavail-overlay">Indisponível</div>}
      </div>
      <div className="product-info">
        <div className="product-name">{prod.nome}</div>
        {prod.descricao && <div className="product-desc">{prod.descricao}</div>}
        <div className="product-footer">
          <div className="product-price">
            {temTamanhos ? (
              <>
                <span className="price-from-label">A partir de</span>
                {fmt(precoApartir(prod))}
              </>
            ) : (
              <>
                {promo && <span className="old-price">{fmt(prod.preco)}</span>}
                {fmt(precoVitrine(prod))}
              </>
            )}
          </div>
          <button className="add-btn" onClick={e=>{e.stopPropagation();console.log('[ENCANTO] Botao + clicado:', prod.id, prod.nome); onOpen(prod);}}>+</button>
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.prod.id          === next.prod.id &&
  prev.prod.disponivel  === next.prod.disponivel &&
  prev.prod.imagem_url  === next.prod.imagem_url &&
  prev.prod.badge       === next.prod.badge &&
  /* PRICE-DOMAIN-01: preço passa a contar na igualdade. preco/preco_promo cobrem produto
     simples (vitrine + PROMO/preço riscado); precoApartir cobre produtos com tamanhos (menor tamanho). */
  prev.prod.preco       === next.prod.preco &&
  prev.prod.preco_promo === next.prod.preco_promo &&
  precoApartir(prev.prod) === precoApartir(next.prod) &&
  prev.catNome          === next.catNome
);
