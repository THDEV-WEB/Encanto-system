import { useState, useMemo, useRef } from 'react';
import { WHATSAPP, LOGO } from '../lib/supabase.js';
import { fmt } from '../utils/format.js';
import { resolverAdicionais, selecionarFonteAdicionais } from '../utils/addons.js';
import { prodInCat, getProdCatIds } from '../utils/catalog.js';
import { catSection } from '../utils/catSection.js';   // REF-UI-CATEGORY-01 Fase 1: fonte unica do id de ancora sec-*
import { STORAGE_KEYS } from '../constants/storage.js';
import { STORE_INFO } from '../constants/storeInfo.js';   // REF-CHECKOUT-ADDRESS-01: endereco de retirada (fonte unica)
import { useCategories } from '../hooks/useCategories.js';
import { useProducts } from '../hooks/useProducts.js';
import { useAdicionais } from '../hooks/useAdicionais.js';
import { useCart } from '../hooks/useCart.js';
import { useBusinessHours } from '../hooks/useBusinessHours.js';   // REF-BUSINESS-HOURS-01: horario oficial (fonte unica)
import { useLoyalty } from '../hooks/useLoyalty.js';               // REF-LOYALTY-01: fidelidade do cliente (fonte unica Supabase)
import { Spinner } from '../components/ui/Spinner.jsx';
import { StoreMenu } from '../components/menu/StoreMenu.jsx'; // LOGIN-ARCH-02: menu lateral (drawer) + login
import { ProductCard } from '../components/ProductCard.jsx';
import { ProductModal } from '../components/ProductModal/index.jsx';
import { CartSidebar } from '../components/CartSidebar.jsx';
import { SearchBar } from '../components/SearchBar.jsx';           // REF-UI-CATEGORY-01 Fase 3: busca do topo — SO no mobile (no desktop vive na barra sticky)
import { CategoryNav } from '../components/nav/CategoryNav.jsx';   // REF-UI-CATEGORY-01 Fase 2: seletor "Categorias v" + scroll-spy (substitui a grade)
import { StickyBar } from '../components/nav/StickyBar.jsx';       // REF-UI-CATEGORY-01 Fase 3: barra sticky do desktop/tablet
import { useStickyReveal } from '../hooks/useStickyReveal.js';     // REF-UI-CATEGORY-01 Fase 3: surge apos rolagem + publica --header-h
import { AddressProvider, useAddress } from '../address/index.js'; // REF-CHECKOUT-ADDRESS-01: fonte unica do endereco (provider)
import { LazySection } from '../components/ui/LazySection.jsx';
import { SuccessPage } from '../components/checkout/SuccessPage.jsx';
import { CheckoutPage } from '../components/checkout/CheckoutPage.jsx';
import { DS } from '../services/DataService.js';                       // REF-CLIENTE-02: catalogo atual p/ recompra
import { montarRecompra } from '../components/pedidos/recompra.js';   // REF-CLIENTE-02 Onda 4 (regras puras)

let _cpStore = false;   // REF-BOOT-02 v2: checkpoint render-phase da loja (uma vez)
export function StoreApp({ onAdmin }) {
  if (!_cpStore) { _cpStore = true; try { if (typeof window !== 'undefined' && window.__ENC_BOOT__ && window.__ENC_BOOT__.step) window.__ENC_BOOT__.step('CP-StoreApp-render', 'StoreApp() render-phase'); } catch { /* noop */ } }
  /* REF-CHECKOUT-ADDRESS-01: a loja inteira (Header + Checkout) vive sob o AddressProvider — FONTE UNICA
     do endereco de entrega. O AddressModal e renderizado uma unica vez pelo provider (overlay sobre o
     Header ou o Checkout). App.jsx nao ganha responsabilidade: o provider e escopo da loja. */
  return (
    <AddressProvider>
      <StoreAppContent onAdmin={onAdmin} />
    </AddressProvider>
  );
}

function StoreAppContent({ onAdmin }) {
  const [page,          setPage]         = useState('home');
  const [selCat,        setSelCat]        = useState(null);
  const [search,        setSearch]        = useState('');
  const [modal,         setModal]         = useState(null);
  const [cartOpen,      setCartOpen]      = useState(false);
  const [waMsg,         setWaMsg]         = useState('');
  /* Estado visual do header — não afeta lógica */
  const [deliveryMode,   setDeliveryMode]   = useState('entrega');
  /* REF-CHECKOUT-ADDRESS-01: FONTE UNICA do endereco (contexto). O header apenas EXIBE o rotulo e abre
     o modal (abrirEndereco); a edicao/persistencia e do provider. Sem estado paralelo de endereco. */
  const { endereco: enderecoObj, abrirModal: abrirEndereco } = useAddress();
  const deliveryAddress = enderecoObj?.label || '';
  const [showLoyalty,    setShowLoyalty]     = useState(false);
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

  const { cats, src:catSrc }                    = useCategories();
  const { prods:rawProds, loading, src:prodSrc }= useProducts(selCat, search);
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
  const revealed = useStickyReveal(sentinelRef, !!search);   // booleano: re-sincroniza SO na transicao catalogo<->resultados (nao a cada tecla)
  const stickyVisible = revealed || !!search;
  /* Barra visivel SEM ter sido revelada por rolagem (ex.: busca ativa no topo) -> reserva a altura dela
     (spacer) para nao cobrir a barra de entrega. So no desktop/tablet (a barra nao existe no mobile). */
  const dockedAtTop = stickyVisible && !revealed;
  const prods  = useMemo(()=>rawProds.map(p=>({
    ...p,
    _catNome: catMap[p.categoria_id]?.nome||'',
    /* _catIds: array de todas as categorias do produto (para uso interno) */
    _catIds: getProdCatIds(p),
  })),[rawProds,catMap]);

  if (page==='checkout') return <CheckoutPage cart={cart} deliveryMode={deliveryMode} onBack={()=>setPage('home')} onSuccess={msg=>{setWaMsg(msg);setPage('success');}}/>;
  if (page==='success')  return <SuccessPage  msg={waMsg} cart={cart} onBack={()=>setPage('home')}/>;

  return (
    <div className="app">
      {/* ── HEADER PRINCIPAL (roxo) ── */}
      <header className="header">

        {/* Coluna esquerda: logo */}
        <div className="header-brand-col">
          {LOGO && <img loading="lazy"
            src={LOGO} alt="Encanto" className="header-brand-logo"
            onClick={()=>{
              /* Acesso oculto: 5 cliques rápidos na logo */
              const now = Date.now();
              const key = STORAGE_KEYS.LOGO_CLICKS;
              const raw = JSON.parse(sessionStorage.getItem(key)||'[]');
              const recent = [...raw.filter(t=>now-t<3000), now];
              sessionStorage.setItem(key, JSON.stringify(recent));
              if (recent.length >= 5) {
                sessionStorage.removeItem(key);
                onAdmin();
              }
            }}
            style={{cursor:'default'}}
          />}
        </div>

        {/* Centro: nome da marca + status */}
        <div className="header-logo">
          <div className="header-logo-text">
            <span className="brand-name" style={{display:'flex',alignItems:'baseline',gap:7}}>
              Encanto
              <span style={{
                fontSize:12,fontWeight:600,color:'rgba(255,255,255,.55)',
                letterSpacing:'.5px',textTransform:'uppercase',
              }}>Timbó</span>
            </span>
            <span className="brand-sub">Marmita e Açaí</span>
            <div className="status-actions">
              <div className={`header-status-pill ${storeOpen?'open':'closed'}`}>
                <span className={`status-dot ${storeOpen?'open':'closed'}`}/>
                {horario.rotuloCurto}
              </div>
              {horario.detalhe && (
                <span style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,.78)',whiteSpace:'nowrap'}}>
                  {horario.detalhe}
                </span>
              )}
              {!storeOpen && (
                <button className="btn-agendar" onClick={()=>alert('Agendamento em breve!')}>
                  📅 Agendar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Direita: carrinho + engrenagem + menu ☰ (LOGIN-ARCH-02) */}
        <div className="header-actions">
          <button className="header-cart-btn" onClick={()=>setCartOpen(true)}>
            🛒{cart.count>0&&<span> {fmt(cart.total)}</span>}
            {cart.count>0&&<span className="cart-badge">{cart.count}</span>}
          </button>
          <button className="header-admin-btn" onClick={onAdmin} title="Painel Admin">
            ⚙️
          </button>
          <StoreMenu onRecomprar={recomprar} />
        </div>

      </header>

      {/* ── BARRA STICKY (desktop/tablet) — REF-UI-CATEGORY-01 Fase 3: surge abaixo do header ao rolar.
          Fixed -> nao ocupa espaco no fluxo; oculta em <768px (strip mobile e a Fase 4). ── */}
      <StickyBar
        cats={catsVisiveis}
        search={search}
        setSearch={setSearch}
        setSelCat={setSelCat}
        visible={stickyVisible}
      />
      {/* Reserva a altura da barra sticky quando ela esta ancorada no topo (busca) — evita cobrir a
          barra de entrega. Oculto no mobile (a barra nao existe la). */}
      {dockedAtTop && <div className="enc-stickybar-spacer" aria-hidden="true" />}

      {/* ── BARRA DE ENTREGA/RETIRADA (branca, abaixo do header) — REF-UX-02 ── */}
      <div className="delivery-bar">
        <div className="delivery-mode-select">
          <select
            className="delivery-mode-dropdown"
            value={deliveryMode}
            onChange={e=>setDeliveryMode(e.target.value)}
            aria-label="Escolher entre entrega ou retirada">
            <option value="entrega">Entrega</option>
            <option value="retirada">Retirada</option>
          </select>
        </div>

        <div className="delivery-eta">
          {deliveryMode==='entrega'
            ? <>em até <b>35–45 min</b></>
            : <>Pronto em <b>20 min</b></>}
        </div>

        {deliveryMode==='entrega' ? (
          <button
            className={`delivery-address-btn ${deliveryAddress?'filled':''}`}
            onClick={abrirEndereco}>
            <span className="delivery-address-pin">📍</span>
            <span className="delivery-address-text">
              {deliveryAddress || 'Selecionar endereço'}
            </span>
          </button>
        ) : (
          <div className="delivery-address-store">
            <span className="delivery-address-pin">📍</span>
            <span className="delivery-address-text">
              {STORE_INFO.retirada.split(',').map((linha, i) => (
                <span key={i} className="delivery-address-line">{linha.trim()}</span>
              ))}
            </span>
          </div>
        )}
      </div>

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
      {/* REF-UI-CATEGORY-01 Fase 3: no DESKTOP a busca vive na barra sticky (topo = so "Categorias v", D4).
          No MOBILE ela continua aqui no topo (a barra sticky nao existe no celular ate a Fase 4/lupa) —
          `.top-search-mobile` some no desktop via CSS. */}
      <div className="top-search-mobile">
        <SearchBar
          cats={cats}
          search={search}
          setSearch={setSearch}
          setSelCat={setSelCat}
        />
      </div>

      {!search&&(
        <>
          <div className="hero">
            {/* Badge estrelas + botão fidelidade lado a lado */}
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12,position:'relative',zIndex:1}}>
              <div className="delivery-badge" style={{marginBottom:0}}>
                <div className="delivery-badge-stars">
                  {[1,2,3,4,5].map(i=>(
                    <svg key={i} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  ))}
                </div>
                <span className="delivery-badge-text">Entrega rápida</span>
              </div>
              <button
                onClick={()=>alert('Em breve teremos novidades para nossos clientes mais fiéis! ❤️')}
                style={{
                  display:'inline-flex',alignItems:'center',gap:6,
                  background:loyaltyReward?'#FBBF24':'rgba(255,255,255,.18)',
                  border:'1.5px solid '+(loyaltyReward?'#F59E0B':'rgba(255,255,255,.35)'),
                  color:loyaltyReward?'#78350F':'#fff',
                  borderRadius:999,padding:'5px 14px',
                  fontSize:12,fontWeight:700,cursor:'pointer',
                  fontFamily:'var(--font-body)',letterSpacing:'.2px',
                  transition:'all .2s',whiteSpace:'nowrap',
                }}>
                {loyaltyReward?'🎁 Recompensa disponível!':'🎁 Programa Fidelidade'}
              </button>
            </div>
            <h1>Peça seu açaí ou marmita favorita</h1>
            <p>Entrega rápida • Ingredientes selecionados • Peça em poucos minutos</p>
          </div>

          {/* Categorias — navegacao por scroll + scroll-spy (REF-UI-CATEGORY-01 Fase 2) substitui a grade de chips */}
          {!selCat && <CategoryNav cats={catsVisiveis} />}
          {/* REF-UI-CATEGORY-01 Fase 3: sentinela — quando rola para debaixo do header, a barra sticky surge */}
          <div ref={sentinelRef} className="catnav-sentinel" aria-hidden="true" />

          {/* ── CATÁLOGO — ordem 100% controlada por cats (coluna 'ordem' do Supabase) ── */}
          {!selCat&&(loading?<Spinner/>:cats.map(cat=>{
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
      )}

      {/* ── RESULTADOS DE BUSCA ── */}
      {search&&(
        <div className="products-section" style={{paddingTop:20}}>
          <div className="section-title">🔍 Resultados para "{search}"</div>
          {loading?<Spinner/>:prods.length===0?(
            <div className="empty-state"><div className="icon">🔍</div><p>Nenhum produto encontrado</p></div>
          ):(
            <div className="products-grid">
              {prods.map(p=><ProductCard key={p.id} prod={p} catNome={p._catNome} onOpen={setModal}/>)}
            </div>
          )}
        </div>
      )}

      {/* ── FILTRO POR CATEGORIA SELECIONADA ── */}
      {!search&&selCat&&(
        <div className="products-section" style={{paddingTop:8}}>
          {/* Título da categoria + botão voltar */}
          {(()=>{
            const cat = cats.find(c=>c.id===selCat);
            const nome = cat?.nome || '';
            return (
              <div style={{margin:'0 16px 12px',display:'flex',alignItems:'center',gap:10}}>
                <div className="promo-banner" style={{flex:1,margin:0,cursor:'default'}}>
                  <h3>{cat?.icone||'🍽️'} {nome}</h3>
                </div>
                <button
                  onClick={()=>setSelCat(null)}
                  style={{
                    flexShrink:0,padding:'8px 14px',borderRadius:10,
                    background:'var(--gray-100)',color:'var(--gray-600)',
                    fontSize:13,fontWeight:700,border:'none',cursor:'pointer',
                    fontFamily:'var(--font-body)',whiteSpace:'nowrap',
                  }}>
                  ← Todos
                </button>
              </div>
            );
          })()}
          {loading?<Spinner/>:prods.length===0?(
            <div className="empty-state"><div className="icon">🔍</div><p>Nenhum produto encontrado</p></div>
          ):(
            <div className="products-grid">
              {prods.map(p=><ProductCard key={p.id} prod={p} catNome={p._catNome} onOpen={setModal}/>)}
            </div>
          )}
        </div>
      )}

      <div style={{padding:'32px 16px',textAlign:'center',color:'var(--gray-400)',fontSize:13}}>
        <p>Plataforma desenvolvida por TH System</p>
        <p style={{marginTop:4}}>📱 (38) 99220-3620</p>
      </div>
      </div>{/* /app-content */}

      {/* ── Modal de Seleção de Endereço ── REF-CHECKOUT-ADDRESS-01: renderizado uma unica vez pelo
          AddressProvider (fonte unica); o header so o ABRE via abrirEndereco. */}

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
              <p style={{fontSize:12,color:'var(--gray-400)',marginBottom:12}}>
                Ainda precisa de ajuda?{' '}
                <a
                  href={`https://wa.me/5538992203620`}
                  target="_blank"
                  style={{color:'var(--amarelo)',fontWeight:600,textDecoration:'underline'}}>
                  Entre em contato com a gente
                </a>
              </p>
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
      )}

      {cartOpen&&(
        <CartSidebar
          cart={cart} catMap={catMap}
          onClose={()=>setCartOpen(false)}
          onCheckout={()=>{setCartOpen(false);setPage('checkout');}}
        />
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

      {/* ── ALT 7: Botão WhatsApp flutuante ── */}
      <a
        href={`https://wa.me/${WHATSAPP}`}
        target="_blank"
        className="wa-float"
        title="Fale conosco pelo WhatsApp">
        <span className="wa-float-icon">💬</span>
        <div className="wa-float-text">
          <span className="l1">Precisa de ajuda?</span>
          <span className="l2">Fale conosco</span>
        </div>
      </a>

    </div>
  );
}
