/* tests/render.smoke.mjs — REF-APP-01 · R9 (rede de render). Roda com: node tests/render.smoke.mjs  (npm run test:render)
   Renderiza componentes-folha APRESENTACIONAIS via react-dom/server (renderToStaticMarkup), com props FIXAS,
   e compara o markup a um snapshot CONGELADO. JSX compilado por esbuild (loader _render-loader.mjs). Sem DOM,
   sem browser, sem rede, sem Supabase — node puro (mesmo estilo dos golden tests).

   PARA QUE SERVE: a partir da Onda 4, cada folha visual extraída do App.jsx entra aqui como 1 caso com o markup
   congelado NO MOMENTO DA EXTRAÇÃO (que, sendo move-puro, iguala o markup original). Qualquer drift de markup
   dessa folha em ondas futuras reprova o teste.

   ESCOPO (plano R9): SÓ folhas apresentacionais puras (sem hooks/DS/Supabase/browser). Orquestrador (StoreApp)
   e componentes browser-heavy (AddressModal, LazySection) NÃO entram aqui — seguem em smoke manual por onda.

   NBSP: fmt() emite o preço com NBSP (U+00A0, code 160). A comparação normaliza NBSP -> espaço comum, então os
   snapshots ficam legíveis (sem char invisível na fonte) e nbsp-vs-espaço não conta como drift.

   COMO ADICIONAR UMA FOLHA (Onda 4): importe o componente; adicione um caso { nome, el, snap:null }; rode uma vez
   (o teste imprime o markup atual do caso sem snapshot); cole esse markup em `snap`; rode de novo -> verde. */
import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./_render-loader.mjs', import.meta.url);

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const h = React.createElement;
const NBSP = String.fromCharCode(160);
const norm = s => s.split(NBSP).join(' ');

/* Componentes sob teste (import dinâmico, após register do loader) */
const AppShell        = (await import('../src/AppShell.jsx')).default;
const BackgroundLayer = (await import('../src/BackgroundLayer.jsx')).default;
const Spinner         = (await import('../src/components/ui/Spinner.jsx')).Spinner;
const ProductCard     = (await import('../src/components/ProductCard.jsx')).ProductCard;
const ProductModalBoundary = (await import('../src/components/ProductModal/ProductModalBoundary.jsx')).ProductModalBoundary;
const CartSidebar     = (await import('../src/components/CartSidebar.jsx')).CartSidebar;

/* Casos: props FIXAS + snapshot CONGELADO (Onda 4 acrescenta as folhas visuais AQUI) */
const CASES = [
  {
    nome: 'BackgroundLayer',
    el: () => h(BackgroundLayer),
    snap: '<div class="bg-layer" aria-hidden="true"></div>',
  },
  {
    nome: 'AppShell(children)',
    el: () => h(AppShell, null, h('span', null, 'X')),
    snap: '<div class="app-shell"><div class="bg-layer" aria-hidden="true"></div><div class="app-content-layer"><span>X</span></div></div>',
  },
  {
    nome: 'Spinner',
    el: () => h(Spinner),
    snap: '<div class="loading-state"><div class="spinner"></div><span>Carregando...</span></div>',
  },
  {
    /* prod SEM tamanhos, sem promo, sem badge, disponível, sem imagem válida -> placeholder + precoVitrine */
    nome: 'ProductCard',
    el: () => h(ProductCard, {
      prod: { id:'pc-fix', nome:'Produto Teste', descricao:'Descrição teste', preco:19.9, preco_promo:null, badge:null, disponivel:true, imagem_url:'' },
      catNome: 'Açaí',
      onOpen: () => {},
    }),
    snap: '<div class="product-card" data-prod="pc-fix"><div class="product-img"><div class="product-img-placeholder" style="display:flex">🍧</div></div><div class="product-info"><div class="product-name">Produto Teste</div><div class="product-desc">Descrição teste</div><div class="product-footer"><div class="product-price">R$ 19,90</div><button class="add-btn">+</button></div></div></div>',
  },
  {
    /* sem erro → o boundary renderiza os children */
    nome: 'ProductModalBoundary(children)',
    el: () => h(ProductModalBoundary, { onClose: () => {} }, h('span', null, 'ok')),
    snap: '<span>ok</span>',
  },
  {
    /* carrinho vazio -> ramo cart-empty */
    nome: 'CartSidebar(vazio)',
    el: () => h(CartSidebar, {
      cart: { items: [], total: 0, remove: () => {}, updateQty: () => {} },
      catMap: {},
      onClose: () => {},
      onCheckout: () => {},
    }),
    snap: '<div class="cart-overlay"></div><div class="cart-sidebar"><div class="cart-header"><h2>🛒 Seu Pedido</h2><button class="cart-close">✕</button></div><div class="cart-empty"><div class="icon">🛒</div><p>Seu carrinho está vazio.<br/>Adicione itens para continuar!</p></div><div class="cart-footer"><div class="cart-total-row"><span>Subtotal</span><span>R$ 0,00</span></div><div class="cart-total-row"><span>Entrega</span><span style="color:var(--green);font-weight:600">A combinar</span></div><div class="cart-total-row grand"><span>Total</span><span>R$ 0,00</span></div><button class="checkout-btn" disabled="">Finalizar Pedido →</button></div></div>',
  },
];

let fail = 0;
for (const c of CASES) {
  const got = renderToStaticMarkup(c.el());
  if (c.snap == null) {
    fail++;
    console.error('  x ' + c.nome + ' — SEM snapshot congelado. Markup atual (copie para snap):\n    ' + got);
    continue;
  }
  try {
    assert.strictEqual(norm(got), norm(c.snap));
    console.error('  ok ' + c.nome);
  } catch {
    fail++;
    console.error('  x ' + c.nome + ' — markup divergiu\n    esperado: ' + c.snap + '\n    obtido:   ' + got);
  }
}
console.log(fail === 0 ? '\nOK render.smoke — ' + CASES.length + ' folha(s), markup estável' : '\nFALHA: ' + fail + ' caso(s) divergente(s)/sem snapshot');
process.exit(fail === 0 ? 0 : 1);
