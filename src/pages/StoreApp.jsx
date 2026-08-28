import { useState, useMemo, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, lazy, Suspense } from 'react';
import { fmt } from '../utils/format.js';
import { resolverAdicionais, selecionarFonteAdicionais } from '../utils/addons.js';
import { prodInCat } from '../utils/catalog.js';
import { catSection } from '../utils/catSection.js';   // REF-UI-CATEGORY-01 Fase 1: fonte unica do id de ancora sec-*
import { STORE_INFO } from '../constants/storeInfo.js';   // REF-CHECKOUT-ADDRESS-01: endereco de retirada (fonte unica)
import { useCategories } from '../hooks/useCategories.js';
import { useProducts } from '../hooks/useProducts.js';
import { useAdicionais } from '../hooks/useAdicionais.js';
import { useCart } from '../hooks/useCart.js';
import { useBusinessHours } from '../hooks/useBusinessHours.js';   // REF-BUSINESS-HOURS-01: horario oficial (fonte unica)
import { useLoyalty } from '../hooks/useLoyalty.js';               // REF-LOYALTY-01: fidelidade do cliente (fonte unica Supabase)
import { Spinner } from '../components/ui/Spinner.jsx';
import { CatalogSkeleton } from '../components/ui/CatalogSkeleton.jsx'; // REF-PERF-02: reserva espaco aproximado da grade real, evita o salto de layout do Spinner generico
import { StoreMenu } from '../components/menu/StoreMenu.jsx'; // LOGIN-ARCH-02: menu lateral (drawer) + login
import { ProductCard } from '../components/ProductCard.jsx';
import { DeliveryBar } from '../components/DeliveryBar.jsx';       // REF-UI-HEADER-02: barra Entrega/Retirada extraida (seletor + ETA + endereco-link)
import { StoreHighlights } from '../components/StoreHighlights.jsx'; // REF-UI-TOPBAR-01: chips de destaque (substituem o banner .hero)
import { CategoryNav } from '../components/nav/CategoryNav.jsx';   // REF-UI-CATEGORY-01 Fase 2: seletor "Categorias v" (desktop/tablet)
import { StickyBar } from '../components/nav/StickyBar.jsx';       // REF-UI-CATEGORY-01 Fase 3: barra sticky do desktop/tablet
import { MobileCatStrip } from '../components/nav/MobileCatStrip.jsx'; // REF-UI-CATEGORY-01 Fase 4: strip de categorias + lupa (mobile)
import { useStickyReveal } from '../hooks/useStickyReveal.js';     // REF-UI-CATEGORY-01 Fase 3: barra de categorias surge apos rolagem (header nao-sticky)
import { useCatalogNav } from '../hooks/useCatalogNav.js';         // REF-UI-CATEGORY-01 Fase 4: scroll-spy + rolagem UNICOS (compartilhados)
import { useSearchSuggestions } from '../hooks/useSearchSuggestions.js'; // REF-UI-SEARCH-01: motor de sugestoes (dados)
import { useScrollToProduct } from '../hooks/useScrollToProduct.js';     // REF-UI-SEARCH-01: navegacao ate o produto + realce
import { useDeliveryEta } from '../hooks/useDeliveryEta.js';             // REF-DELIVERY-01: tempo de entrega (config unica Supabase)
import { useCompanyInfo } from '../hooks/useCompanyInfo.js';             // REF-COMPANY-01: dados institucionais (config unica Supabase)
import { AddressProvider, useAddress } from '../address/index.js'; // REF-CHECKOUT-ADDRESS-01: fonte unica do endereco (provider)
import { useAuth } from '../hooks/useAuth.js'; // REF-SEC-DATA-01 R12: detecta logout de verdade p/ limpar endereco/carrinho
import { useStorefrontStore } from '../hooks/useStorefrontStore.js'; // REF-SAAS-01 · Onda 6.1: loja resolvida por dominio
import { LazySection } from '../components/ui/LazySection.jsx';
import { DS } from '../services/DataService.js';                       // REF-CLIENTE-02: catalogo atual p/ recompra
import { montarRecompra } from '../components/pedidos/recompra.js';   // REF-CLIENTE-02 Onda 4 (regras puras)
import { ValionCredit } from '../components/ValionCredit.jsx';        // REF-BRAND-02: assinatura institucional do rodape

/* REF-PERF-01: code splitting — nenhum destes 4 e necessario pra 1a renderizacao (chegam so por
   interacao: abrir um produto, abrir o carrinho, ir pro checkout). Cada um vira um chunk proprio,
   baixado sob demanda em vez de entrar no bundle inicial da loja (achado da auditoria: bundle unico
   de 538KB/155KB gzip, ~92KB estimados pelo Lighthouse como JS nao usado no boot). Exports nomeados
   -> `.then(m => ({default: m.X}))` remapeia pro formato que React.lazy exige. */
const ProductModal = lazy(() => import('../components/ProductModal/index.jsx').then(m => ({ default: m.ProductModal })));
const CartSidebar   = lazy(() => import('../components/CartSidebar.jsx').then(m => ({ default: m.CartSidebar })));
const CheckoutPage  = lazy(() => import('../components/checkout/CheckoutPage.jsx').then(m => ({ default: m.CheckoutPage })));
const SuccessPage   = lazy(() => import('../components/checkout/SuccessPage.jsx').then(m => ({ default: m.SuccessPage })));

// REF-CAP-01 · Onda 4: forwardRef repassado até StoreAppContent — único consumidor é o botão físico
// "voltar" do Android (hooks/useCapacitorBackButton.js via App.jsx), que precisa fechar o que estiver
// aberto na loja (modal/carrinho/fidelidade/menu) sem StoreApp virar dono de nenhum router novo.
export const StoreApp = forwardRef(function StoreApp(_props, ref) {
  /* REF-SAAS-01 · Onda 6.1: loja resolvida por dominio com status != 'ativo' (suspensa/cancelada) —
     nunca mostra o catalogo (que seria de uma loja errada sob o dominio certo), so uma mensagem clara.
     `store` continua null ate get_store_by_domain resolver (nao bloqueante) — nesse meio-tempo o
     catalogo normal renderiza (fallback = loja padrao, mesmo comportamento de sempre). */
  const { store } = useStorefrontStore();
  if (store && store.status !== 'ativo') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Loja indisponível</h1>
          <p style={{ color: 'var(--gray-500)' }}>{store.nome} não está disponível no momento.</p>
        </div>
      </div>
    );
  }
  /* REF-CHECKOUT-ADDRESS-01: a loja inteira (Header + Checkout) vive sob o AddressProvider — FONTE UNICA
     do endereco de entrega. O AddressModal e renderizado uma unica vez pelo provider (overlay sobre o
     Header ou o Checkout). App.jsx nao ganha responsabilidade: o provider e escopo da loja. */
  return (
    <AddressProvider>
      <StoreAppContent ref={ref} />
    </AddressProvider>
  );
});

const StoreAppContent = forwardRef(function StoreAppContent(_props, ref) {
  const [page,          setPage]         = useState('home');
  const [search,        setSearch]        = useState('');
  const [modal,         setModal]         = useState(null);
  const [cartOpen,      setCartOpen]      = useState(false);
  const [waMsg,         setWaMsg]         = useState('');
  /* Estado visual do header — não afeta lógica */
  const [deliveryMode,   setDeliveryMode]   = useState('entrega');
  /* REF-CHECKOUT-ADDRESS-01: FONTE UNICA do endereco (contexto). O header apenas EXIBE o rotulo e abre
     o modal (abrirEndereco); a edicao/persistencia e do provider. Sem estado paralelo de endereco. */
  const { endereco: enderecoObj, temEndereco, abrirModal: abrirEndereco, limpar: limparEndereco } = useAddress();
  const [showLoyalty,    setShowLoyalty]     = useState(false);
  const [loyaltyTeaser,  setLoyaltyTeaser]   = useState(false);   // teaser "em breve" do chip de fidelidade (troca o alert() nativo, que sempre mostraria o dominio em vez do nome da loja)
  /* ── Programa de Fidelidade (REF-LOYALTY-01) ── fonte unica: Supabase (get_my_loyalty), por CLIENTE.
     O visitante nao-logado ve zeros (fidelidade nao pertence ao navegador). O cliente logado ve o
     PROPRIO saldo, sincronizado entre dispositivos. localStorage e so cache (dentro do hook). */
  const { estado: loyalty, temCadastro, resgatar: resgatarFidelidade } = useLoyalty();
  const [resgatando,  setResgatando]  = useState(false);
  const [resgateErro, setResgateErro] = useState('');
  const loyaltyConfig  = { required: loyalty.required, discount: loyalty.discount };
  const loyaltyEnabled = loyalty.enabled;                              // programa ligado?
  const loyaltyCount   = loyalty.stamps;
  const loyaltyReward  = loyalty.rewardAvailable && loyalty.enabled;   // fix (#5): desativado nunca oferece recompensa
  /* REF-BUSINESS-HOURS-01: status vem do horário oficial (fonte única, services/businessHours) — sem
     heurística de horário aqui. O hook reavalia sozinho na virada de período/dia e aplica o override
     manual do Admin (STORE_STATUS='closed' força fechado). */
  const horario = useBusinessHours();
  const storeOpen = horario.aberto;
  const cart = useCart();

  /* REF-SEC-DATA-01 R12: logout limpa endereco/carrinho — sem isso, um dispositivo compartilhado
     herdava o endereco/carrinho completo do cliente anterior. AddressProvider/useCart vivem ABAIXO do
     AuthProvider na arvore (App.jsx), entao sair() (AuthProvider.jsx) nao consegue chama-los direto —
     este efeito reage a MUDANCA de status. So dispara na TRANSICAO real 'logged'->'anon' (nunca no
     mount inicial, que sempre passa por 'loading' primeiro) — um visitante nunca logado nunca passa
     por 'logged', entao seu carrinho/endereco proprio nunca e tocado por aqui. */
  const { status: authStatus } = useAuth();
  const prevAuthStatusRef = useRef(authStatus);
  useEffect(() => {
    if (prevAuthStatusRef.current === 'logged' && authStatus === 'anon') {
      limparEndereco();
      cart.clear();
    }
    prevAuthStatusRef.current = authStatus;
  }, [authStatus, limparEndereco, cart]);

  /* REF-CLIENTE-02 Onda 4: "Pedir novamente" — re-adiciona os itens do pedido antigo resolvendo pelo
     catalogo ATUAL (preco atual via pricing; pula custom/indisponivel/que exige tamanho-variante) e
     abre o carrinho para o cliente revisar antes do checkout normal. Nunca copia preco antigo. */
  const recomprar = async (pedido) => {
    const catalogo = await DS.getProds(null, '');
    if (!catalogo) return { erro: true, add: 0, pulados: [] };
    const { adicionar, pulados } = montarRecompra(pedido?.order_items, catalogo);
    adicionar.forEach(a => cart.add(a.prod, a.qty, [], a.obs));
    if (adicionar.length > 0) setCartOpen(true);
    return { erro: false, add: adicionar.length, pulados };
  };

  const { cats, loading:catLoading, src:catSrc } = useCategories();
  const { prods:rawProds, loading:prodLoading, src:prodSrc }= useProducts(null, '');   // REF-UI-SEARCH-01: catalogo SEMPRE completo — a busca virou dropdown de sugestoes (nao filtra mais a lista)
  /* REF-PERF-05 (achado da auditoria de CLS residual): useCategories/useProducts sao 2 fetches
     INDEPENDENTES (REF-PERF-03 — cada hook espera a resolucao do tenant e busca por conta propria).
     O gate de renderizacao usava so' `prodLoading` -- se `categories` demorasse mais que `products`
     pra resolver (ordem de rede nao garantida, mesmo host/latencia parecida), existia uma janela real
     em que `loading=false` mas `cats` ainda vazio: `cats.map(...)` produzia ZERO secoes (colapsando o
     catalogo por completo), ate' `cats` chegar um instante depois e as secoes reaparecerem -- 2 saltos
     de layout medidos via PerformanceObserver (confirmado: ate 0,36 de CLS sozinho, elemento afetado
     era tudo que vem depois do catalogo, ex. o rodape ValionCredit, empurrado e puxado de volta em
     ~300ms). `loading` combinado espera as DUAS fontes, sem criar fetch novo nem tocar a ordem
     tenant->catalogo da REF-PERF-03 -- so' adia a troca skeleton->grade real ate' os dois dados
     realmente existirem juntos. */
  const loading = catLoading || prodLoading;
  const adicionais = useAdicionais();

  const catMap = useMemo(()=>{ const m={}; cats.forEach(c=>{m[c.id]=c;}); return m; },[cats]);
  /* REF-UI-CATEGORY-01 Fase 2: categorias VISIVEIS = as que tem >=1 produto disponivel (mesmo criterio
     do catalogo, que pula categoria vazia com `if (catProds.length===0) return null`). O CategoryNav
     recebe SO estas -> a lista nunca oferece um destino sem secao (sem clique morto) e o scroll-spy
     nunca destaca uma secao inexistente. Preserva a ordem de `cats` (coluna 'ordem'). */
  const catsVisiveis = useMemo(
    ()=>cats.filter(c=>rawProds.some(p=>prodInCat(p,c.id) && p.disponivel!==false)),
    [cats,rawProds]
  );
  /* REF-UI-CATEGORY-01 Fase 3: a barra sticky (desktop/tablet) surge quando a sentinela do topo
     (logo apos o "Categorias v" da pagina) rola para debaixo do header. Durante uma busca ela fica
     visivel de qualquer forma (abriga o campo de busca, que migrou do topo). */
  const sentinelRef = useRef(null);
  const revealed = useStickyReveal(sentinelRef, !!search);   // trigger !!search re-sincroniza a revelacao ao alternar o contexto de busca (nao a cada tecla)
  const stickyVisible = revealed || !!search;
  /* REF-UI-SEARCH-01: o catalogo (e a sentinela) agora ficam SEMPRE montados — a busca virou dropdown,
     nao troca mais a tela. Com o header estatico, o spacer (1o filho de .app, ANTES do header) so precisa
     reservar a altura da barra quando ela esta ancorada no topo SEM ter sido revelada por rolagem (busca
     ativa perto do inicio). Se ja rolado/revelado, o header ja saiu (nada a cobrir) e inserir/remover o
     spacer causaria um SALTO de conteudo em navegadores sem scroll-anchoring (Safari) — por isso o gate
     `&& !revealed`. Como a sentinela agora persiste, `revealed` e preciso (sem lag). Altura por breakpoint. */
  const dockedAtTop = !!search && !revealed;
  /* REF-UI-CATEGORY-01 Fase 4: scroll-spy + rolagem suave UNICOS (uma so instancia), compartilhados
     pelas 3 superficies (dropdown do topo, barra sticky do desktop, strip do mobile) via props. */
  const { activeId, irParaCategoria } = useCatalogNav(catsVisiveis);
  /* REF-UI-SEARCH-01: motor de sugestoes (dados) + navegacao ate o produto. As sugestoes derivam do
     catalogo ja carregado (rawProds) e das categorias VISIVEIS (as que realmente renderizam secao) —
     mesma fonte que o catalogo desenha, sem estado paralelo. Escolher uma categoria rola ate a secao
     (irParaCategoria) e um produto rola ate o card + realce (scrollToProduct). */
  const suggestions = useSearchSuggestions(search, rawProds, catsVisiveis);
  const scrollToProduct = useScrollToProduct();
  const onPickCategoria = useCallback((c) => irParaCategoria(c.cat), [irParaCategoria]);
  const onPickProduto   = useCallback((p) => scrollToProduct(p.prod.id, p.secId), [scrollToProduct]);
  /* REF-DELIVERY-01 (+REF-GOLIVE-01): tempo estimado de entrega (config unica no Supabase). Lido UMA vez
     aqui e distribuido por props aos consumidores (DeliveryBar + CheckoutPage + SuccessPage) -> Single
     Source of Truth, sem duplicacao. REF-GOLIVE-01 estendeu o alcance a CheckoutPage (mensagem de
     confirmacao do WhatsApp) — antes so DeliveryBar/SuccessPage recebiam o valor vivo. */
  const deliveryEta = useDeliveryEta();
  /* REF-COMPANY-01: dados institucionais da empresa (config unica no Supabase). O whatsapp oficial
     alimenta o checkout (SuccessPage) SEMPRE a partir do cadastro da empresa — nunca mais hardcoded. */
  const companyInfo = useCompanyInfo();

  /* REF-SAAS-01 · Onda 6.2: branding por loja — SÓ neste bundle (storefront); o Admin não é skinado
     por loja (ver companyInfoRules.js). Não bloqueia o render (mesmo espírito não-bloqueante da Onda
     6.1) — para a Encanto hoje os defaults do servidor já são idênticos ao CSS estático (zero flash).
     --magenta/--grape e --roxo/--acai são pares sinônimos de compatibilidade (mesmo hex) — sempre os
     dois lados juntos, senão dessincroniza. */
  useEffect(() => {
    const root = document.documentElement.style;
    if (companyInfo.corPrimaria) {
      root.setProperty('--magenta', companyInfo.corPrimaria);
      root.setProperty('--grape', companyInfo.corPrimaria);
    }
    if (companyInfo.corSecundaria) {
      root.setProperty('--roxo', companyInfo.corSecundaria);
      root.setProperty('--acai', companyInfo.corSecundaria);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', companyInfo.corSecundaria);
    }
    if (companyInfo.corDestaque) root.setProperty('--amarelo', companyInfo.corDestaque);
    // REF-SAAS-02 · Onda 3: SEMPRE define um href (nunca condicional a existir faviconUrl) -- sem tenant
    // configurado, cai no valion-mark (marca neutra, mesmo default ja usado no index.html estatico antes
    // do JS montar); se o admin REMOVE um favicon proprio depois de ja ter tido um nesta MESMA sessao
    // (tab aberta), o <link> precisa voltar pro neutro, nao ficar preso no ultimo valor setado.
    document.querySelectorAll('link[rel="icon"]').forEach((link) => {
      link.setAttribute('href', companyInfo.faviconUrl || `${import.meta.env.BASE_URL}valion-mark.png`);
    });
  }, [companyInfo.corPrimaria, companyInfo.corSecundaria, companyInfo.corDestaque, companyInfo.faviconUrl]);

  // REF-CAP-01 · Onda 4: resumo imperativo do que está "aberto" na loja, na ordem em que o botão físico
  // "voltar" do Android deve fechar (o mais recente/por cima primeiro). Nenhum estado novo — só expõe o
  // que já existe acima (page/modal/cartOpen/showLoyalty) + o que o StoreMenu já expõe (menu/telas).
  const storeMenuRef = useRef(null);
  useImperativeHandle(ref, () => ({
    temAlgoAberto: () => page === 'checkout' || page === 'success' || !!modal || cartOpen || showLoyalty || loyaltyTeaser || !!storeMenuRef.current?.temAlgoAberto(),
    fecharTopo: () => {
      if (page === 'checkout' || page === 'success') { setPage('home'); return; }
      if (modal) { setModal(null); return; }
      if (loyaltyTeaser) { setLoyaltyTeaser(false); return; }
      if (cartOpen) { setCartOpen(false); return; }
      if (showLoyalty) { setShowLoyalty(false); return; }
      storeMenuRef.current?.fecharTudo();
    },
  }), [page, modal, cartOpen, showLoyalty, loyaltyTeaser]);

  if (page==='checkout') return <Suspense fallback={<Spinner/>}><CheckoutPage cart={cart} deliveryMode={deliveryMode} deliveryEta={deliveryEta} onBack={()=>setPage('home')} onSuccess={msg=>{setWaMsg(msg);setPage('success');}}/></Suspense>;
  if (page==='success')  return <Suspense fallback={<Spinner/>}><SuccessPage  msg={waMsg} cart={cart} onBack={()=>setPage('home')} deliveryEta={deliveryEta} deliveryMode={deliveryMode} whatsapp={companyInfo.whatsapp} horario={horario}/></Suspense>;

  return (
    <div className="app">
      {/* Reserva a altura da barra fixa quando ela esta ancorada no topo por BUSCA (sem ter sido revelada
          por rolagem). Como o header agora NAO e sticky e a barra fica em top:0, o spacer vem ANTES do
          header: empurra a pagina inteira para baixo da barra, evitando que a barra cubra o header.
          Altura por breakpoint (barra desktop ~57px / strip mobile ~50px). */}
      {dockedAtTop && <div className="enc-stickybar-spacer" aria-hidden="true" />}

      {/* ── HEADER PRINCIPAL (roxo) ── */}
      {/* REF-BRAND-01: --header-bg-url setada aqui (nao em index.css) pois url('/header-bg.jpg')
          absoluto nao e reescrito pelo Vite quando base != '/' (app agora servido sob /encanto/).
          REF-PERF-01: .webp (gerado por scripts/optimize-static-images.mjs) — 352,7KB -> 79KB, mesma
          imagem/qualidade visual, so' resolucao/formato adequados ao tamanho real exibido (96-128px
          de altura). Original .jpg preservado em public/ (nao usado em runtime).
          REF-SAAS-02 · Onda 2: companyInfo.bannerUrl (por loja, Storage) tem prioridade -- Sem bannerUrl
          (loja nova), cai num gradiente NEUTRO com as cores da PROPRIA loja -- nunca a foto da Encanto
          como fallback silencioso.
          REF-SAAS-02 · Onda 3: bannerUrl da Encanto migrou do path fisico do bundle (/encanto/header-
          bg.webp, um "atalho" que sobrava da Onda 2) pro Storage (stores/{id}/branding/..., mesma
          convencao de logoUrl/faviconUrl) -- bytes byte-identicos, zero mudanca visual, só deixou de
          depender de um arquivo do bundle fisico compartilhado por todo tenant. */}
      <header className="header" style={{ '--header-bg-url': companyInfo.bannerUrl
        ? `url(${companyInfo.bannerUrl})`
        : `linear-gradient(135deg, ${companyInfo.corPrimaria || '#6B7280'}, ${companyInfo.corSecundaria || '#374151'})` }}>

        {/* Coluna esquerda: logo */}
        <div className="header-brand-col">
          {/* REF-ADMIN-04 · Onda 4: acesso oculto de 5 cliques removido — o Admin agora vive em
              app/dominio proprios (admin.encanto.valionsistemas.com.br), sem entrada nenhuma na loja.
              REF-SAAS-02 · Onda 2: logoPreset ('organico', padrao/Encanto, ou 'retangular', sem recorte
              -- pra logos horizontais/quadradas de novos tenants) escolhe a classe CSS de apresentacao.
              REF-SAAS-02 · Onda 3: fallback pro asset fisico local (LOGO, `/encanto/logo.webp`) removido —
              era a logo REAL da Encanto compartilhada pelo bundle unico de todos os tenants; um tenant
              novo sem logoUrl configurado herdaria silenciosamente a marca da Encanto (achado real, mesma
              classe do leak ja fechado pra bannerUrl/sobre). Encanto ganhou logoUrl explicito (Storage,
              mesmo arquivo/bytes, seed operacional) -- sem logoUrl, nenhuma loja mostra logo nenhuma
              (cai no nome em texto, ja renderizado ao lado). */}
          {companyInfo.logoUrl && (
            <img loading="lazy" src={companyInfo.logoUrl} alt={companyInfo.nomeCurto}
              className={`header-brand-logo${companyInfo.logoPreset === 'retangular' ? ' header-brand-logo--retangular' : ''}`}
              style={{cursor:'default'}} />
          )}
        </div>

        {/* Centro: nome da marca + status */}
        <div className="header-logo">
          <div className="header-logo-text">
            <span className="brand-name" style={{display:'flex',alignItems:'baseline',gap:7}}>
              {companyInfo.nomeCurto}
              {/* REF-SAAS-01 · Onda 6.3: cidade vem de companyInfo.cidade (endereco institucional, por
                  loja) — nunca mais um literal fixo. Oculta o span quando a loja ainda nao configurou
                  (mesmo padrao "nunca link morto" dos campos opcionais de company_info). */}
              {companyInfo.cidade && (
                <span style={{
                  /* REF-UI-CATEGORY-01 (refino UX): cidade — secundaria, porem legivel sobre a foto do
                     banner (saiu de .55 "lavado" p/ .9 + text-shadow). Sem virar destaque. */
                  fontSize:12,fontWeight:600,color:'rgba(255,255,255,.9)',
                  letterSpacing:'.5px',textTransform:'uppercase',
                  textShadow:'0 1px 6px rgba(0,0,0,.6)',
                }}>{companyInfo.cidade}</span>
              )}
            </span>
            <span className="brand-sub">Marmita e Açaí</span>
            <div className="status-actions">
              {/* REF-UI-HERO-03: status + horario ficam JUNTOS numa linha; o CTA desce para logo ABAIXO. */}
              <div className="status-line">
                <div className={`header-status-pill ${storeOpen?'open':'closed'}`}>
                  <span className={`status-dot ${storeOpen?'open':'closed'}`}/>
                  {horario.rotuloCurto}
                </div>
                {horario.detalhe && (
                  /* REF-UI-CATEGORY-01 (refino UX): detalhe do horario — legivel sobre a foto (.78 -> .95 + sombra) */
                  <span style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,.95)',whiteSpace:'nowrap',textShadow:'0 1px 6px rgba(0,0,0,.6)'}}>
                    {horario.detalhe}
                  </span>
                )}
              </div>
              {/* REF-UI-HERO-03: "Agendar Pedido" imediatamente abaixo da info de horario (CTA junto do
                  operacional, sem competir com o resto do Hero). So aparece com a loja fechada. */}
              {!storeOpen && (
                <button className="btn-agendar" onClick={()=>alert('Agendamento em breve!')}>
                  📅 Agendar Pedido
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Direita: carrinho + menu ☰ (LOGIN-ARCH-02) — REF-ADMIN-04 Onda 4: engrenagem removida */}
        <div className="header-actions">
          <button className="header-cart-btn" data-testid="header-cart-btn" onClick={()=>setCartOpen(true)}>
            🛒{cart.count>0&&<span> {fmt(cart.total)}</span>}
            {cart.count>0&&<span className="cart-badge">{cart.count}</span>}
          </button>
          <StoreMenu ref={storeMenuRef} onRecomprar={recomprar} />
        </div>

      </header>

      {/* ── BARRA STICKY (desktop/tablet) — REF-UI-CATEGORY-01 Fase 3 (refino UX): surge no TOPO (top:0)
          ao rolar; com o header nao-sticky ela e o unico elemento fixo. Fixed -> nao ocupa espaco no
          fluxo; oculta em <768px (strip mobile e a Fase 4). ── */}
      <StickyBar
        cats={catsVisiveis}
        activeId={activeId}
        onSelect={irParaCategoria}
        search={search}
        setSearch={setSearch}
        visible={stickyVisible}
        suggestions={suggestions}
        onPickCategory={onPickCategoria}
        onPickProduct={onPickProduto}
        brandName={companyInfo.nomeCurto}
        logoUrl={companyInfo.logoUrl}
      />
      {/* ── STRIP MOBILE (celular) — REF-UI-CATEGORY-01 Fase 4: abas horizontais + lupa, surge ao rolar.
          Fixed; oculto em >=768px (la e a barra do desktop). ── */}
      <MobileCatStrip
        cats={catsVisiveis}
        activeId={activeId}
        onSelect={irParaCategoria}
        search={search}
        setSearch={setSearch}
        visible={stickyVisible}
        suggestions={suggestions}
        onPickCategory={onPickCategoria}
        onPickProduct={onPickProduto}
      />
      {/* ── BARRA DE ENTREGA/RETIRADA (branca, abaixo do header) — REF-UX-02 / REF-UI-HEADER-02 ──
          Extraida para <DeliveryBar/> (apresentacional). deliveryMode segue aqui (vai ao checkout); o
          endereco vem da fonte unica (AddressProvider): editar = abrirEndereco (mesmo modal), limpar =
          volta ao estado inicial. */}
      <DeliveryBar
        deliveryMode={deliveryMode}
        setDeliveryMode={setDeliveryMode}
        endereco={enderecoObj}
        temEndereco={temEndereco}
        onEditar={abrirEndereco}
        onLimpar={limparEndereco}
        retiradaLabel={STORE_INFO.retirada}
        deliveryEta={deliveryEta}
      />

      {/* ── Progresso de fidelidade mini (abaixo da barra de entrega) — so p/ cliente logado c/ programa ativo ── */}
      {temCadastro && loyaltyEnabled && loyaltyCount>0 && !loyaltyReward && (
        <div
          onClick={()=>setShowLoyalty(true)}
          style={{
            background:'var(--grape-pale)',padding:'8px 20px',cursor:'pointer',
            display:'flex',alignItems:'center',gap:10,
            borderBottom:'1px solid #DDD6FE',
          }}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:'var(--amarelo)',fontWeight:600,marginBottom:3}}>
              🎁 Fidelidade: {loyaltyCount} de {loyaltyConfig.required} pedidos
            </div>
            <div style={{
              height:4,background:'#DDD6FE',borderRadius:2,overflow:'hidden',
            }}>
              <div style={{
                height:'100%',borderRadius:2,
                width:`${Math.min(100,(loyaltyCount/loyaltyConfig.required)*100)}%`,
                background:'linear-gradient(90deg,#A62786,#C8D82B)',
              }}/>
            </div>
          </div>
          <span style={{fontSize:11,color:'var(--amarelo)',fontWeight:700,whiteSpace:'nowrap'}}>
            Ver detalhes →
          </span>
        </div>
      )}
      {temCadastro && loyaltyReward && (
        <div
          onClick={()=>setShowLoyalty(true)}
          style={{
            background:'#FBBF24',padding:'8px 20px',cursor:'pointer',
            display:'flex',alignItems:'center',gap:10,
            borderBottom:'1px solid #F59E0B',
          }}>
          <span style={{fontSize:16}}>🎁</span>
          <span style={{fontSize:12,fontWeight:700,color:'#78350F',flex:1}}>
            Você ganhou 50% de desconto! Clique para resgatar.
          </span>
          <span style={{fontSize:11,color:'#92400E',fontWeight:700}}>→</span>
        </div>
      )}

      <div className="app-content">
      {/* REF-UI-CATEGORY-01 Fase 4: a busca do topo saiu tambem do mobile. Agora a navegacao/busca vive
          na chrome que surge ao rolar: barra sticky (desktop) e strip + lupa (mobile).
          REF-UI-TOPBAR-01: o topo deixou de ter banner promocional — sobram so os chips de destaque
          (StoreHighlights) e, logo abaixo, "Categorias" como porta de entrada do cardapio. */}

      {/* REF-UI-SEARCH-01: catalogo SEMPRE renderizado (o modelo de sugestoes substituiu a pagina de
          resultados). A busca abre um dropdown na barra/strip e navega ate o produto/secao aqui mesmo. */}
      <>
          {/* REF-UI-TOPBAR-01: chips leves com os diferenciais da loja — preservam a acao do antigo botao
              de fidelidade (inclusive o estado de recompensa). Sem banner/foto/titulo.
              REF-LOYALTY-AUDIT-01 · Onda 4: onLoyalty era incondicional (sempre abria o teaser "Em breve",
              mesmo com cadastro/progresso real) — achado de integracao nunca concluida desde REF-LOYALTY-01.
              Com cadastro e programa ativo, abre o modal REAL (mesmo que o contador/banner ja abrem);
              sem cadastro ou com o programa desativado, mantem o teaser (nada real pra mostrar ainda). */}
          <StoreHighlights
            loyaltyReward={loyaltyReward}
            onLoyalty={()=>{ if (temCadastro && loyaltyEnabled) setShowLoyalty(true); else setLoyaltyTeaser(true); }}
          />

          {/* Categorias — navegacao por scroll + scroll-spy (REF-UI-CATEGORY-01 Fase 2) substitui a grade de chips.
              refino UX: quando a barra sticky assume o topo (revealed), este "Categorias" da pagina some
              (cross-fade, sem reflow via visibility) para nunca haver DOIS "Categorias" na tela ao mesmo tempo. */}
          <CategoryNav cats={catsVisiveis} activeId={activeId} onSelect={irParaCategoria} className={revealed ? 'catnav-docked' : ''} />
          {/* REF-UI-CATEGORY-01 Fase 3: sentinela — quando rola para debaixo do header, a barra sticky surge */}
          <div ref={sentinelRef} className="catnav-sentinel" aria-hidden="true" />

          {/* ── CATÁLOGO — ordem 100% controlada por cats (coluna 'ordem' do Supabase) ── */}
          {(loading?<CatalogSkeleton/>:cats.map(cat=>{
            const nome = (cat.nome||'').toLowerCase();
            const catProds = rawProds.filter(p=>prodInCat(p, cat.id) && p.disponivel!==false);
            if (catProds.length===0) return null;

            /* Estilos especiais por categoria — preservados exatamente como antes.
               REF-UI-CATEGORY-01 Fase 1: o id de ancora (secId) agora vem da FONTE UNICA
               catSection(cat) (utils/catSection.js) — mesmo resultado da cadeia if/else-if
               que existia aqui, porem sem triplicacao. A cadeia abaixo cuida SO de titulo/estilo. */
            const secId = catSection(cat);
            let title   = cat.nome;
            let bannerStyle = {margin:'0 16px 12px',cursor:'default'};
            let sectionStyle = {paddingTop:20,scrollMarginTop:20};
            let displayProds = catProds;

            if (nome.includes('destaque')) {
              title = 'Destaques';
              sectionStyle = {paddingTop:12,scrollMarginTop:16};
              bannerStyle = {margin:'0 16px 12px',cursor:'default',
                background:'linear-gradient(120deg,#B45309 0%,#D97706 100%)',
                boxShadow:'0 4px 12px rgba(180,83,9,.25)'};
            } else if (nome.includes('combo')) {
              title = 'Combos';
            } else if (nome.includes('fitness')) {
              title = '💪 Pedido Fitness';
              bannerStyle = {margin:'0 16px 12px',cursor:'default',
                background:'linear-gradient(120deg,#15803D 0%,#22C55E 100%)',
                boxShadow:'0 4px 12px rgba(21,128,61,.25)'};
            }

            /* REF-UI-TOPBAR-01: a 1a secao renderizada "cola" em "Categorias" (porta de entrada do
               cardapio) — paddingTop curto SO nela; as demais mantem o ritmo normal entre secoes.
               scrollMarginTop preservado (offset de navegacao com a barra sticky). */
            if (cat.id === catsVisiveis[0]?.id) sectionStyle = { ...sectionStyle, paddingTop:4 };

            return (
              <LazySection key={cat.id} id={secId} style={sectionStyle}>
                <div className="products-section">
                  <div className="promo-banner" style={bannerStyle}>
                    <h3>{title}</h3>
                  </div>
                  <div className="products-grid">
                    {displayProds.map(p=><ProductCard key={p.id} prod={{...p,_catNome:cat.nome}} catNome={cat.nome} onOpen={setModal}/>)}
                  </div>
                </div>
              </LazySection>
            );
          }))}
        </>

      <div style={{padding:'32px 16px',textAlign:'center'}}>
        <ValionCredit />
      </div>
      </div>{/* /app-content */}

      {/* ── Modal de Seleção de Endereço ── REF-CHECKOUT-ADDRESS-01: renderizado uma unica vez pelo
          AddressProvider (fonte unica); o header so o ABRE via abrirEndereco. */}

      {/* ── Teaser "em breve" do chip de fidelidade ── dialog proprio (nao alert() nativo): o alert()
          do browser sempre prefixa com o DOMINIO da pagina ("valionsistemas.com.br diz"), nunca com o
          nome da loja — texto que o navegador controla, o app nao tem como sobrescrever. Aqui o titulo
          usa companyInfo.nomeCurto (REF-COMPANY-02: fonte unica do nome institucional). */}
      {loyaltyTeaser&&(
        <div className="modal-overlay" style={{alignItems:'center',justifyContent:'center'}} onClick={e=>e.target===e.currentTarget&&setLoyaltyTeaser(false)}>
          <div style={{background:'var(--white)',borderRadius:16,width:'min(92vw,340px)',padding:'20px 20px 8px',boxShadow:'0 20px 60px rgba(0,0,0,.3)'}}>
            <strong style={{fontSize:16,display:'block',marginBottom:8}}>{companyInfo.nomeCurto} diz</strong>
            <p style={{fontSize:14,color:'var(--gray-800)',lineHeight:1.5,margin:0}}>Em breve teremos novidades para nossos clientes mais fiéis! ❤️</p>
            <div style={{display:'flex',justifyContent:'flex-end',margin:'12px -8px 0 0'}}>
              <button onClick={()=>setLoyaltyTeaser(false)} style={{border:'none',background:'none',color:'var(--grape)',fontWeight:700,fontSize:15,cursor:'pointer',padding:'10px 12px'}}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Programa de Fidelidade ── */}
      {showLoyalty&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowLoyalty(false)}>
          <div className="modal" style={{maxWidth:440,maxHeight:'92vh',overflowY:'auto'}}>

            {/* Cabeçalho roxo */}
            <div style={{
              background:'linear-gradient(135deg,#6B21A8,#7C3AED)',
              padding:'28px 24px 22px',textAlign:'center',
              borderRadius:'var(--radius-xl) var(--radius-xl) 0 0',position:'relative',
            }}>
              <div style={{fontSize:48,marginBottom:8,lineHeight:1}}>🎁</div>
              <h2 style={{
                color:'#fff',fontFamily:'var(--font-head)',fontSize:22,
                fontWeight:800,margin:0,letterSpacing:'.5px',textTransform:'uppercase',
              }}>
                Programa de Fidelidade
              </h2>
              <p style={{color:'rgba(255,255,255,.8)',fontSize:14,marginTop:8,lineHeight:1.5}}>
                A cada {loyaltyConfig.required} pedidos você ganha {loyaltyConfig.discount}% de desconto no próximo pedido.
              </p>
            </div>

            {/* Corpo */}
            <div style={{padding:'24px 24px 8px'}}>

              {/* ── Estado: RECOMPENSA DISPONÍVEL ── */}
              {loyaltyReward ? (
                <div style={{textAlign:'center',padding:'8px 0 16px'}}>
                  <div style={{fontSize:52,marginBottom:12}}>🎉</div>
                  <h3 style={{
                    fontFamily:'var(--font-head)',fontSize:22,fontWeight:800,
                    color:'#15803D',marginBottom:12,
                  }}>Parabéns!</h3>
                  <div style={{
                    background:'#F0FDF4',border:'1.5px solid #BBF7D0',
                    borderRadius:14,padding:'16px 20px',marginBottom:20,
                  }}>
                    <p style={{fontSize:15,color:'#15803D',fontWeight:700,marginBottom:4}}>
                      Você ganhou {loyaltyConfig.discount}% de desconto no próximo pedido!
                    </p>
                    <p style={{fontSize:13,color:'#166534',lineHeight:1.5}}>
                      Informe ao atendente no momento da finalização do pedido.
                      O resgate somente poderá ser feito pelo próprio participante.
                    </p>
                  </div>
                  <button
                    disabled={resgatando}
                    onClick={async ()=>{
                      /* REF-LOYALTY-01: resgate no BACKEND (redeem_reward, atomico). Consome a recompensa
                         e reinicia o ciclo no Supabase — nunca no navegador. */
                      if (resgatando) return;
                      setResgatando(true); setResgateErro('');
                      const r = await resgatarFidelidade();
                      setResgatando(false);
                      if (r.ok) { setShowLoyalty(false); }
                      else setResgateErro(r.error === 'offline'
                        ? 'Sem conexão — tente novamente.'
                        : 'Não foi possível resgatar agora. Tente novamente.');
                    }}
                    style={{
                      padding:'13px 32px',borderRadius:12,border:'none',
                      background:'linear-gradient(135deg,#16A34A,#15803D)',
                      color:'#fff',fontWeight:700,fontSize:15,cursor:resgatando?'default':'pointer',
                      opacity:resgatando?0.7:1,
                      fontFamily:'var(--font-body)',boxShadow:'0 4px 16px rgba(22,163,74,.3)',
                    }}>
                    {resgatando ? 'Resgatando…' : '✅ Usar desconto agora'}
                  </button>
                  {resgateErro && <p style={{fontSize:13,color:'#DC2626',marginTop:12,fontWeight:600}}>{resgateErro}</p>}
                </div>
              ) : (
                <>
                  {/* Progresso: X de Y pedidos */}
                  <div style={{
                    background:'var(--grape-pale)',borderRadius:14,
                    padding:'18px 20px',textAlign:'center',marginBottom:20,
                  }}>
                    <div style={{fontSize:13,color:'var(--amarelo)',fontWeight:600,marginBottom:6}}>
                      Você já realizou:
                    </div>
                    <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:4}}>
                      <span style={{
                        fontFamily:'var(--font-head)',fontSize:44,fontWeight:800,color:'var(--amarelo)',lineHeight:1,
                      }}>{loyaltyCount}</span>
                      <span style={{fontSize:20,color:'var(--gray-400)',fontWeight:500}}>
                        de {loyaltyConfig.required} pedidos
                      </span>
                    </div>
                    <p style={{fontSize:13,color:'var(--gray-500)',marginTop:8}}>
                      {loyaltyConfig.required - loyaltyCount === 1
                        ? 'Falta apenas 1 pedido para ganhar seu desconto!'
                        : `Faltam ${loyaltyConfig.required - loyaltyCount} pedidos para ganhar ${loyaltyConfig.discount}% de desconto`
                      }
                    </p>
                  </div>

                  {/* Barra de progresso */}
                  <div style={{marginBottom:6}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-400)',marginBottom:6}}>
                      <span>Progresso</span>
                      <span>{Math.round((loyaltyCount/loyaltyConfig.required)*100)}%</span>
                    </div>
                    <div style={{
                      width:'100%',height:14,background:'var(--gray-100)',
                      borderRadius:7,overflow:'hidden',
                    }}>
                      <div style={{
                        height:'100%',borderRadius:7,
                        width:`${Math.min(100,(loyaltyCount/loyaltyConfig.required)*100)}%`,
                        background:'linear-gradient(90deg,#A62786,#C8D82B)',
                        transition:'width .5s ease',
                      }}/>
                    </div>
                  </div>

                  {/* Grade de pedidos */}
                  <div style={{
                    display:'flex',gap:6,flexWrap:'wrap',
                    justifyContent:'center',margin:'20px 0 8px',
                  }}>
                    {Array.from({length:loyaltyConfig.required}).map((_,i)=>(
                      <div key={i} title={i<loyaltyCount?`Pedido ${i+1} concluído`:`Pedido ${i+1}`}
                        style={{
                          width:36,height:36,borderRadius:10,
                          background: i<loyaltyCount
                            ? 'linear-gradient(135deg,#6B21A8,#A855F7)'
                            : 'var(--gray-100)',
                          border: i<loyaltyCount ? 'none' : '1.5px solid var(--gray-200)',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:16,transition:'all .2s',
                          boxShadow: i<loyaltyCount ? '0 2px 8px rgba(107,33,168,.3)' : 'none',
                        }}>
                        {i<loyaltyCount ? '🛍️' : <span style={{color:'var(--gray-300)',fontSize:18}}>○</span>}
                      </div>
                    ))}
                  </div>
                  <p style={{fontSize:11,color:'var(--gray-400)',textAlign:'center',marginBottom:4}}>
                    Somente pedidos aprovados ou finalizados pela loja são contabilizados.
                  </p>
                </>
              )}
            </div>

            {/* Regulamento */}
            <div style={{
              margin:'0 24px',padding:'16px',
              background:'var(--gray-50)',borderRadius:12,
              border:'1px solid var(--gray-100)',
            }}>
              <p style={{
                fontSize:12,fontWeight:700,color:'var(--gray-700)',
                marginBottom:10,textTransform:'uppercase',letterSpacing:'.5px',
              }}>
                📋 Regras do Programa
              </p>
              {[
                'Peça 10 vezes e ganhe 50% de desconto no próximo pedido.',
                'O pedido só contabiliza após ser aprovado ou finalizado pela loja.',
                'O valor do frete não é contabilizado — somente os products.',
                'Após o resgate, a pontuação é zerada e o acúmulo reinicia.',
                'As recompensas não são cumulativas — apenas 1 por ciclo.',
                'A mecânica do programa pode ser alterada a qualquer momento pela loja.',
              ].map((r,i)=>(
                <div key={i} style={{
                  display:'flex',gap:8,marginBottom:i<5?8:0,
                  fontSize:12,color:'var(--gray-600)',lineHeight:1.5,
                }}>
                  <span style={{color:'var(--amarelo)',fontWeight:700,flexShrink:0}}>{i+1}.</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>

            {/* Rodapé */}
            <div style={{padding:'16px 24px 24px',textAlign:'center'}}>
              {/* REF-SAAS-01 · Onda 7.1: link só aparece com whatsapp configurado — nunca um wa.me/
                  sem destino (mesmo padrão "nunca link morto" já usado pros campos opcionais). */}
              {companyInfo.whatsapp && (
                <p style={{fontSize:12,color:'var(--gray-400)',marginBottom:12}}>
                  Ainda precisa de ajuda?{' '}
                  <a
                    href={`https://wa.me/${companyInfo.whatsapp}`}
                    target="_blank"
                    style={{color:'var(--amarelo)',fontWeight:600,textDecoration:'underline'}}>
                    Entre em contato com a gente
                  </a>
                </p>
              )}
              <button
                onClick={()=>setShowLoyalty(false)}
                style={{
                  padding:'10px 32px',borderRadius:10,
                  border:'1.5px solid var(--gray-200)',
                  background:'var(--white)',color:'var(--gray-500)',
                  fontSize:14,fontWeight:600,cursor:'pointer',
                  fontFamily:'var(--font-body)',
                }}>
                Fechar
              </button>
            </div>

          </div>
        </div>
      )}

      {modal&&(
        <Suspense fallback={null}>
          <ProductModal
            prod={modal}
            catNome={(modal._catNome)||''}
            adicionais={resolverAdicionais(selecionarFonteAdicionais(modal, adicionais), modal)}
            onClose={()=>setModal(null)}
            onAdd={(p,q,a,o)=>{ cart.add(p,q,a,o); }}
            onSuggest={()=>{
              setModal(null);
              requestAnimationFrame(()=>{
                const el=document.getElementById('sec-bebidas');
                if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
              });
            }}
          />
        </Suspense>
      )}

      {cartOpen&&(
        <Suspense fallback={null}>
        <CartSidebar
          cart={cart} catMap={catMap}
          onClose={()=>setCartOpen(false)}
          onCheckout={()=>{setCartOpen(false);setPage('checkout');}}
        />
        </Suspense>
      )}

      {/* Carrinho inferior (desktop) + botão flutuante (mobile) */}
      {cart.count>0 && !cartOpen && (
        <>
          {/* Desktop: barra inferior completa */}
          <div className="cart-sticky-bar">
            <div className="cart-sticky-info">
              <div className="qty">{cart.count} {cart.count===1?'item':'itens'} no carrinho</div>
              <div className="val">{fmt(cart.total)}</div>
            </div>
            <button className="cart-sticky-btn" onClick={()=>setCartOpen(true)}>
              Ver carrinho →
            </button>
          </div>
          {/* Mobile: botão flutuante lateral (canto esquerdo) */}
          <button
            className="cart-float-mobile"
            onClick={()=>setCartOpen(true)}
            aria-label={`Carrinho — ${cart.count} ${cart.count===1?'item':'itens'}`}
            style={{display:'none'}} /* CSS mobile sobrescreve com display:flex */
          >
            <span className="cfi">🛒</span>
            <span className="cfq">{cart.count}</span>
          </button>
        </>
      )}

      {/* ── ALT 7: Botão WhatsApp flutuante ── REF-COMPANY-01: some por completo (sem quebrar layout)
          quando o admin desativa companyInfo.whatsappFloatEnabled. REF-SAAS-01 · Onda 7.1: também
          exige companyInfo.whatsapp preenchido — nunca um wa.me/ sem destino (loja sem WhatsApp
          configurado não tem mais o número real da Encanto como fallback). */}
      {companyInfo.whatsappFloatEnabled && companyInfo.whatsapp && (
      <a
        href={`https://wa.me/${companyInfo.whatsapp}`}
        target="_blank"
        className="wa-float"
        title="Fale conosco pelo WhatsApp">
        <span className="wa-float-icon">💬</span>
        <div className="wa-float-text">
          <span className="l1">Precisa de ajuda?</span>
          <span className="l2">Fale conosco</span>
        </div>
      </a>
      )}

    </div>
  );
});
