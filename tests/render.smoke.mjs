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
const DeliveryBar     = (await import('../src/components/DeliveryBar.jsx')).DeliveryBar;   // REF-UI-HEADER-02
const SearchSuggestions = (await import('../src/components/search/SearchSuggestions.jsx')).SearchSuggestions;   // REF-UI-SEARCH-01

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
  {
    /* REF-UI-HEADER-02: barra Entrega/Retirada — entrega SEM endereco (link "Selecionar endereço") */
    nome: 'DeliveryBar(entrega, sem endereço)',
    el: () => h(DeliveryBar, {
      deliveryMode:'entrega', setDeliveryMode:()=>{}, endereco:null, temEndereco:false,
      onEditar:()=>{}, onLimpar:()=>{}, retiradaLabel:'Rua João Schley, 77 Casa 02',
    }),
    snap: '<div class="delivery-bar"><div class="delivery-mode-select"><select class="delivery-mode-dropdown" aria-label="Escolher entre entrega ou retirada"><option value="entrega" selected="">Entrega</option><option value="retirada">Retirada</option></select></div><div class="delivery-info"><div class="delivery-eta">Entregar em, até <b>35–45 min</b></div><div class="delivery-place"><button type="button" class="delivery-addr-link">Selecionar endereço</button></div></div></div>',
  },
  {
    /* REF-UI-HEADER-02: entrega COM endereco (valor + par Alterar/Limpar) */
    nome: 'DeliveryBar(entrega, com endereço)',
    el: () => h(DeliveryBar, {
      deliveryMode:'entrega', setDeliveryMode:()=>{}, endereco:{label:'Rua das Flores, 123 - Centro'}, temEndereco:true,
      onEditar:()=>{}, onLimpar:()=>{}, retiradaLabel:'Rua João Schley, 77 Casa 02',
    }),
    snap: '<div class="delivery-bar"><div class="delivery-mode-select"><select class="delivery-mode-dropdown" aria-label="Escolher entre entrega ou retirada"><option value="entrega" selected="">Entrega</option><option value="retirada">Retirada</option></select></div><div class="delivery-info"><div class="delivery-eta">Entregar em, até <b>35–45 min</b></div><div class="delivery-place"><span class="delivery-addr-current" title="Rua das Flores, 123 - Centro">Rua das Flores, 123 - Centro</span><span class="delivery-addr-actions"><button type="button" class="delivery-addr-action" aria-label="Alterar endereço de entrega">Alterar</button><span class="delivery-addr-sep" aria-hidden="true">·</span><button type="button" class="delivery-addr-action" aria-label="Remover endereço selecionado">Limpar</button></span></div></div></div>',
  },
  {
    /* REF-UI-HEADER-02: retirada (endereco fixo da loja, so leitura) */
    nome: 'DeliveryBar(retirada)',
    el: () => h(DeliveryBar, {
      deliveryMode:'retirada', setDeliveryMode:()=>{}, endereco:null, temEndereco:false,
      onEditar:()=>{}, onLimpar:()=>{}, retiradaLabel:'Rua João Schley, 77 Casa 02',
    }),
    snap: '<div class="delivery-bar"><div class="delivery-mode-select"><select class="delivery-mode-dropdown" aria-label="Escolher entre entrega ou retirada"><option value="entrega">Entrega</option><option value="retirada" selected="">Retirada</option></select></div><div class="delivery-info"><div class="delivery-eta">Retirar em, até <b>20 min</b></div><div class="delivery-place"><span class="delivery-addr-store">Rua João Schley, 77 Casa 02</span></div></div></div>',
  },
  {
    /* REF-UI-SEARCH-01: painel de sugestoes agrupado (categoria + produto) com realce do trecho casado */
    nome: 'SearchSuggestions(agrupado)',
    el: () => h(SearchSuggestions, {
      categorias: [{ cat: { id: 'c1', nome: 'Marmitas' }, parts: { before: '', hit: 'Marm', after: 'itas' } }],
      produtos: [{ prod: { id: 'p1', nome: 'Marmita Fitness' }, catNome: 'Marmitas', nomeParts: { before: '', hit: 'Marm', after: 'ita Fitness' }, sub: 'Marmitas', subParts: null }],
      total: 2, tooShort: false, active: -1,
      onHover: () => {}, onPickCategory: () => {}, onPickProduct: () => {}, onLimpar: () => {},
    }),
    snap: '<div class="enc-suggest" role="listbox" aria-label="Sugestões de busca"><div class="enc-suggest-group"><div class="enc-suggest-group-title">Categorias</div><button type="button" role="option" aria-selected="false" class="enc-suggest-item "><span class="enc-suggest-ico" aria-hidden="true">🍱</span><span class="enc-suggest-txt"><span class="enc-suggest-name"><mark class="enc-suggest-hl">Marm</mark>itas</span></span><span class="enc-suggest-arrow" aria-hidden="true">›</span></button></div><div class="enc-suggest-group"><div class="enc-suggest-group-title">Produtos</div><button type="button" role="option" aria-selected="false" class="enc-suggest-item "><span class="enc-suggest-ico" aria-hidden="true">🍱</span><span class="enc-suggest-txt"><span class="enc-suggest-name"><mark class="enc-suggest-hl">Marm</mark>ita Fitness</span><span class="enc-suggest-sub">Marmitas</span></span></button></div></div>',
  },
  {
    /* REF-UI-SEARCH-01: feedback sem resultados (req 7) */
    nome: 'SearchSuggestions(sem resultados)',
    el: () => h(SearchSuggestions, {
      categorias: [], produtos: [], total: 0, tooShort: false, active: -1,
      onHover: () => {}, onPickCategory: () => {}, onPickProduct: () => {}, onLimpar: () => {},
    }),
    snap: '<div class="enc-suggest" role="listbox" aria-label="Sugestões de busca"><div class="enc-suggest-empty"><div class="enc-suggest-empty-ico" aria-hidden="true">🔍</div><p class="enc-suggest-empty-msg">Nenhum produto encontrado.</p><button type="button" class="enc-suggest-empty-btn">Limpar busca</button></div></div>',
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
