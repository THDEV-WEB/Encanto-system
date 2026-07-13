import { useState, useMemo } from 'react';
import { WHATSAPP, LOGO } from '../lib/supabase.js';
import { fmt } from '../utils/format.js';
import { resolverAdicionais, selecionarFonteAdicionais } from '../utils/addons.js';
import { prodInCat, getProdCatIds } from '../utils/catalog.js';
import { STORAGE_KEYS } from '../constants/storage.js';
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
import { SearchBar } from '../components/SearchBar.jsx';
import { AddressModal, useAddress } from '../address/index.js'; // REF-ADDRESS-01: dominio proprio de endereco
import { LazySection } from '../components/ui/LazySection.jsx';
import { SuccessPage } from '../components/checkout/SuccessPage.jsx';
import { CheckoutPage } from '../components/checkout/CheckoutPage.jsx';
import { DS } from '../services/DataService.js';                       // REF-CLIENTE-02: catalogo atual p/ recompra
import { montarRecompra } from '../components/pedidos/recompra.js';   // REF-CLIENTE-02 Onda 4 (regras puras)

export function StoreApp({ onAdmin }) {
  const [page,          setPage]         = useState('home');
  const [selCat,        setSelCat]        = useState(null);
  const [search,        setSearch]        = useState('');
  const [modal,         setModal]         = useState(null);
  const [cartOpen,      setCartOpen]      = useState(false);
  const [waMsg,         setWaMsg]         = useState('');
  /* Estado visual do header — não afeta lógica */
  const [deliveryMode,   setDeliveryMode]   = useState('entrega');
  /* REF-ADDRESS-01: endereco de entrega + persistencia pertencem ao dominio Address (useAddress).
     O StoreApp so CONSOME (nao le/escreve localStorage de endereco nem monta strings). */
  const { endereco: deliveryAddress, selecionar: selecionarEndereco } = useAddress();
  const [showAddressModal,setShowAddressModal] = useState(false);
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
  const prods  = useMemo(()=>rawProds.map(p=>({
    ...p,
    _catNome: catMap[p.categoria_id]?.nome||'',
    /* _catIds: array de todas as categorias do produto (para uso interno) */
    _catIds: getProdCatIds(p),
  })),[rawProds,catMap]);

  if (page==='checkout') return <CheckoutPage cart={cart} onBack={()=>setPage('home')} onSuccess={msg=>{setWaMsg(msg);setPage('success');}}/>;
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

      {/* ── BARRA DE ENTREGA (branca, abaixo do header) ── */}
      <div className="delivery-bar">
        <div className="delivery-mode-select">
          <span className="delivery-mode-icon">
            {deliveryMode==='entrega'?'🛵':'🏃'}
          </span>
          <select
            className="delivery-mode-dropdown"
            value={deliveryMode}
            onChange={e=>setDeliveryMode(e.target.value)}>
            <option value="entrega">Entrega</option>
            <option value="retirada">Retirada</option>
          </select>
        </div>

        <div className="delivery-bar-divider"/>

        <div className="delivery-eta">
          {deliveryMode==='entrega'
            ? <>Entrega em até <b>35–45 min</b></>
            : <>Pronto em <b>20 min</b></>}
        </div>

        <div className="delivery-bar-divider"/>
        {deliveryMode==='entrega' ? (
          <button
            className={`delivery-address-btn ${deliveryAddress?'filled':''}`}
            onClick={()=>setShowAddressModal(true)}>
            📍 {deliveryAddress
              ? <span style={{maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'inline-block'}}>
                  {deliveryAddress}
                </span>
              : 'Selecionar endereço'}
          </button>
        ) : (
          <div style={{
            display:'inline-flex',alignItems:'center',gap:5,
            fontSize:12,color:'var(--gray-600)',fontWeight:600,
          }}>
            <span>🏪</span>
            <span>Rua João Schlay, 77 Casa 02</span>
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
      {/* ── Barra de busca com dropdown de categorias ── */}
      <SearchBar
        cats={cats}
        search={search}
        setSearch={setSearch}
        setSelCat={setSelCat}
      />

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
                <span className="delivery-badge-text">Delivery Rápido</span>
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
                {loyaltyReward?'🎁 Recompensa disponível!':'🎁 Ganhe presente aqui'}
              </button>
            </div>
            <h1>Açaí & Marmitas<br/>feitos com carinho 💜</h1>
            <p>Um Encanto de Sabores!</p>
          </div>

          {/* ── Categorias: COM "Todos", COM scroll para seção ── */}
          <div className="categories-section">
            <div className="section-title">Categorias</div>
            <div className="categories-scroll">

              {/* ── Todos — primeiro item, volta ao topo ── */}
              <div
                className={`cat-chip ${!selCat?'active':''}`}
                onClick={()=>{
                  setSelCat(null);
                  window.scrollTo({top:0, behavior:'smooth'});
                }}>
                <div className="cat-icon" style={{
                  boxShadow: !selCat ? '0 6px 18px #6B21A840' : undefined,
                  background: !selCat ? '#6B21A8' : '#fff',
                }}>
                  {/* Ícone apps/grid moderno — 4 quadrados iguais */}
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="7"  y="7"  width="14" height="14" rx="4"
                      fill={!selCat?'#fff':'#6B21A8'}/>
                    <rect x="27" y="7"  width="14" height="14" rx="4"
                      fill={!selCat?'rgba(255,255,255,.75)':'#7C3AED'}/>
                    <rect x="7"  y="27" width="14" height="14" rx="4"
                      fill={!selCat?'rgba(255,255,255,.75)':'#7C3AED'}/>
                    <rect x="27" y="27" width="14" height="14" rx="4"
                      fill={!selCat?'rgba(255,255,255,.55)':'#A855F7'}/>
                  </svg>
                </div>
                <span className="cat-name" style={{
                  color: !selCat ? 'var(--grape)' : undefined,
                  fontWeight: !selCat ? 700 : undefined,
                }}>Todos</span>
              </div>

              {/* ── Chips por categoria (com scroll) ── */}
              {cats.map(c => {
                const ativo = selCat === c.id;
                const nome  = (c.nome||'').toLowerCase();
                const activeShadow = ativo ? `0 6px 18px ${c.cor||'#6B21A8'}40` : undefined;

                /* Mapeia categoria → id da seção para scroll */
                const secId = (() => {
                  if (nome.includes('combo'))     return 'sec-combos';
                  if (nome.includes('fitness'))   return 'sec-fitness';
                  if (nome.includes('batidinha')) return 'sec-batidinha';
                  if (nome.includes('destaque'))  return 'sec-destaques';
                  if (nome.includes('monte'))     return 'sec-monte';
                  if (nome.includes('pronto'))    return 'sec-prontos';
                  if (nome.includes('marmita'))   return 'sec-marmitas';
                  if (nome.includes('açaí') || nome.includes('acai')) return 'sec-acai';
                  if (nome.includes('bebida'))    return 'sec-bebidas';
                  return null;
                })();

                const handleClick = () => {
                  setSelCat(c.id);
                };

                const icon = (() => {
                  if (nome.includes('combo')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="4" y="33" width="40" height="5" rx="2.5" fill="#D97706"/>
                      <rect x="6" y="31" width="36" height="4" rx="2" fill="#F59E0B"/>
                      <rect x="10" y="21" width="18" height="10" rx="3" fill="#92400E"/>
                      <rect x="9"  y="19" width="20" height="4"  rx="2" fill="#F97316"/>
                      <rect x="10" y="23" width="18" height="2"  rx="1" fill="#FDE68A"/>
                      <ellipse cx="19" cy="19" rx="10" ry="5" fill="#D97706"/>
                      <ellipse cx="19" cy="18" rx="10" ry="5" fill="#F59E0B"/>
                      <ellipse cx="15" cy="16" rx="1.5" ry=".8" fill="#FEF3C7" transform="rotate(-20 15 16)"/>
                      <ellipse cx="20" cy="15" rx="1.5" ry=".8" fill="#FEF3C7" transform="rotate(10 20 15)"/>
                      <ellipse cx="24" cy="17" rx="1.5" ry=".8" fill="#FEF3C7" transform="rotate(-15 24 17)"/>
                      <path d="M32 14 L35 31 H29 Z" fill="#BFDBFE"/>
                      <path d="M32 14 L35 31 H29 Z" fill="#3B82F6" opacity=".35"/>
                      <rect x="29" y="31" width="6" height="2" rx="1" fill="#1D4ED8"/>
                      <rect x="30" y="8"  width="4" height="6" rx="1" fill="#6B7280"/>
                      <rect x="28" y="13" width="8" height="2" rx="1" fill="#9CA3AF"/>
                    </svg>
                  );
                  if (nome.includes('monte')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 12 L16 40 H32 L35 12 Z" fill="#EDE9FE"/>
                      <path d="M16 26 L17 40 H31 L32 26 Z" fill="#5B21B6"/>
                      <ellipse cx="20" cy="25" rx="2.5" ry="1.2" fill="#FDE68A"/>
                      <ellipse cx="25" cy="24" rx="2"   ry="1"   fill="#FDE68A"/>
                      <ellipse cx="29" cy="25" rx="1.8" ry=".9"  fill="#FDE68A"/>
                      <circle cx="19" cy="23" r="2" fill="#EF4444"/>
                      <circle cx="24" cy="22" r="2" fill="#EF4444"/>
                      <circle cx="29" cy="23" r="1.5" fill="#F59E0B"/>
                      <rect x="30" y="6" width="3" height="20" rx="1.5" fill="#F472B6"/>
                      <rect x="11" y="10" width="26" height="4" rx="2" fill="#8B5CF6"/>
                    </svg>
                  );
                  if (nome.includes('pronto') || (nome.includes('copo') && !nome.includes('monte'))) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 20 L12 42 H36 L38 20 Z" fill="#EDE9FE"/>
                      <path d="M12 30 L13 42 H35 L36 30 Z" fill="#4C1D95"/>
                      <ellipse cx="24" cy="30" rx="10" ry="2.5" fill="#92400E" opacity=".6"/>
                      <rect x="9"  y="16" width="30" height="6" rx="3" fill="#A78BFA"/>
                      <rect x="11" y="17" width="26" height="4" rx="2" fill="#C4B5FD" opacity=".7"/>
                      <rect x="19" y="13" width="10" height="5" rx="2.5" fill="#7C3AED"/>
                      <rect x="11" y="39" width="26" height="3" rx="1.5" fill="#6D28D9"/>
                      <path d="M37 10 Q42 10 42 15 Q42 18 39 19 L38 42" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" fill="none"/>
                      <ellipse cx="39.5" cy="13" rx="3" ry="3.5" fill="#D1D5DB"/>
                    </svg>
                  );
                  if (nome.includes('marmita')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <ellipse cx="24" cy="39" rx="20" ry="4" fill="#E5E7EB"/>
                      <ellipse cx="24" cy="38" rx="20" ry="3" fill="#F3F4F6"/>
                      <ellipse cx="24" cy="32" rx="18" ry="8" fill="#fff" stroke="#E5E7EB" strokeWidth="1.2"/>
                      <ellipse cx="24" cy="32" rx="14" ry="6" fill="#F9FAFB"/>
                      <ellipse cx="17" cy="31" rx="6"   ry="4"   fill="#FEFCE8"/>
                      <ellipse cx="16" cy="31" rx="1.5" ry="1"   fill="#78350F" opacity=".9"/>
                      <ellipse cx="19" cy="32" rx="1.3" ry=".9"  fill="#92400E" opacity=".9"/>
                      <ellipse cx="31" cy="31" rx="7"   ry="5"   fill="#92400E"/>
                      <ellipse cx="30" cy="30" rx="4"   ry="2.5" fill="#B45309"/>
                      <circle cx="24" cy="27" r="2.5" fill="#16A34A"/>
                      <circle cx="22" cy="25" r="2"   fill="#22C55E"/>
                      <circle cx="26" cy="25" r="2"   fill="#16A34A"/>
                      <path d="M6 20 Q6 10 24 10 Q42 10 42 20" stroke="#D1D5DB" strokeWidth="2" fill="#F9FAFB"/>
                      <rect x="20" y="6" width="8" height="5" rx="2.5" fill="#9CA3AF"/>
                    </svg>
                  );
                  if (nome.includes('açaí') || nome.includes('acai')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 20 L12 42 H36 L38 20 Z" fill="#F3E8FF"/>
                      <path d="M12 30 L14 42 H34 L36 30 Z" fill="#4C1D95"/>
                      <path d="M14 30 Q16 26 18 29 Q20 25 21 28 Q22 24 24 27 Q26 24 27 28 Q28 25 30 29 Q32 26 34 30 Z" fill="#fff" opacity=".9"/>
                      <circle cx="19" cy="27" r="2" fill="#EF4444"/>
                      <circle cx="24" cy="26" r="2" fill="#EF4444"/>
                      <circle cx="29" cy="27" r="1.8" fill="#F59E0B"/>
                      <rect x="31" y="8"  width="3" height="18" rx="1.5" fill="#F472B6"/>
                      <rect x="9"  y="17" width="30" height="5" rx="2.5" fill="#7C3AED"/>
                      <rect x="11" y="39" width="26" height="3" rx="1.5" fill="#6D28D9"/>
                    </svg>
                  );
                  if (nome.includes('bebida')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11 14 L14 43 H34 L37 14 Z" fill="#E0F2FE"/>
                      <path d="M13 22 L15 43 H33 L35 22 Z" fill="#FED7AA"/>
                      <path d="M13 22 L15 43 H33 L35 22 Z" fill="#F97316" opacity=".35"/>
                      <rect x="15" y="24" width="7" height="6" rx="2" fill="#BAE6FD" opacity=".8"/>
                      <rect x="24" y="27" width="6" height="5" rx="2" fill="#BAE6FD" opacity=".8"/>
                      <rect x="9"  y="11" width="30" height="5" rx="2.5" fill="#0284C7"/>
                      <circle cx="36" cy="13" r="5.5" fill="#FEF08A" stroke="#EAB308" strokeWidth="1"/>
                      <circle cx="36" cy="13" r="3.5" fill="#FDE047"/>
                      <line x1="36" y1="9.5" x2="36" y2="16.5" stroke="#CA8A04" strokeWidth=".7"/>
                      <line x1="32.5" y1="13" x2="39.5" y2="13" stroke="#CA8A04" strokeWidth=".7"/>
                      <rect x="30" y="4" width="3.5" height="22" rx="1.75" fill="#F472B6"/>
                      <rect x="13" y="16" width="3" height="22" rx="1.5" fill="#fff" opacity=".3"/>
                    </svg>
                  );
                  /* ── PEDIDO FITNESS ── */
                  if (nome.includes('fitness')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Haltere profissional */}
                      <rect x="4"  y="20" width="8"  height="8"  rx="3" fill={ativo?'#fff':'#16A34A'} opacity={ativo?1:.9}/>
                      <rect x="36" y="20" width="8"  height="8"  rx="3" fill={ativo?'#fff':'#16A34A'} opacity={ativo?1:.9}/>
                      <rect x="8"  y="22" width="32" height="4"  rx="2" fill={ativo?'rgba(255,255,255,.7)':'#4ADE80'}/>
                      <rect x="12" y="17" width="6"  height="14" rx="2.5" fill={ativo?'#D1FAE5':'#22C55E'}/>
                      <rect x="30" y="17" width="6"  height="14" rx="2.5" fill={ativo?'#D1FAE5':'#22C55E'}/>
                      {/* Folha / saúde */}
                      <path d="M24 8 Q28 4 34 6 Q32 14 24 14 Q16 14 14 6 Q20 4 24 8Z"
                        fill={ativo?'#BBF7D0':'#16A34A'} opacity=".8"/>
                      <path d="M24 8 L24 14" stroke={ativo?'#fff':'#15803D'} strokeWidth="1.5" strokeLinecap="round"/>
                      {/* Coração fitness */}
                      <path d="M22 39 Q20 36 18 37 Q16 38 18 41 L22 45 L26 41 Q28 38 26 37 Q24 36 22 39Z"
                        fill={ativo?'#FCA5A5':'#EF4444'} opacity=".9"/>
                    </svg>
                  );

                  /* ── BATIDINHA DE AÇAÍ ── */
                  if (nome.includes('batidinha')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Copo com shake */}
                      <path d="M12 14 L15 42 H33 L36 14 Z" fill="#EDE9FE"/>
                      <path d="M14 26 L16 42 H32 L34 26 Z" fill="#6B21A8"/>
                      {/* Chantilly/espuma */}
                      <path d="M14 26 Q16 21 18 24 Q20 19 21 23 Q22 18 24 22 Q26 18 27 23 Q28 19 30 24 Q32 21 34 26 Z"
                        fill="#fff" opacity=".95"/>
                      {/* Frutas no topo */}
                      <circle cx="18" cy="20" r="2.5" fill="#EF4444"/>
                      <circle cx="24" cy="18" r="2.5" fill="#EF4444"/>
                      <circle cx="30" cy="20" r="2.5" fill="#F59E0B"/>
                      {/* Canudo */}
                      <rect x="32" y="6" width="3" height="20" rx="1.5" fill="#F472B6"/>
                      {/* Borda superior e base */}
                      <rect x="10" y="12" width="28" height="4" rx="2" fill="#7C3AED"/>
                      <rect x="14" y="39" width="20" height="3" rx="1.5" fill="#6D28D9"/>
                      {/* Brilho */}
                      <rect x="13" y="16" width="3" height="20" rx="1.5" fill="#fff" opacity=".25"/>
                    </svg>
                  );

                  /* ── DESTAQUES ── */
                  if (nome.includes('destaque')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Estrela dourada profissional */}
                      <path d="M24 6 L28.5 17.5 H41 L30.5 24.5 L34.5 36 L24 29 L13.5 36 L17.5 24.5 L7 17.5 H19.5 Z"
                        fill={ativo?'#FDE68A':'#FBBF24'} stroke={ativo?'#F59E0B':'#D97706'} strokeWidth="1.2"
                        strokeLinejoin="round"/>
                      {/* Brilhos */}
                      <circle cx="24" cy="21" r="3" fill={ativo?'#FEF9C3':'#FEF3C7'} opacity=".7"/>
                      <circle cx="32" cy="11" r="2" fill="#FEF3C7" opacity=".6"/>
                      <circle cx="16" cy="11" r="1.5" fill="#FEF3C7" opacity=".5"/>
                    </svg>
                  );
                  return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="24" cy="28" r="14" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="1.5"/>
                      <ellipse cx="24" cy="29" rx="7" ry="5" fill="#FDE68A"/>
                      <circle cx="21" cy="27" r="2"   fill="#F97316"/>
                      <circle cx="26" cy="29" r="1.5" fill="#EF4444"/>
                    </svg>
                  );
                })();

                return (
                  <div key={c.id}
                    className={`cat-chip ${ativo?'active':''}`}
                    onClick={handleClick}>
                    <div className="cat-icon" style={{boxShadow:activeShadow}}>
                      {icon}
                    </div>
                    <span className="cat-name">{c.nome}</span>
                  </div>
                );
              })}

            </div>
          </div>

          {/* ── CATÁLOGO — ordem 100% controlada por cats (coluna 'ordem' do Supabase) ── */}
          {!selCat&&(loading?<Spinner/>:cats.map(cat=>{
            const nome = (cat.nome||'').toLowerCase();
            const catProds = rawProds.filter(p=>prodInCat(p, cat.id) && p.disponivel!==false);
            if (catProds.length===0) return null;

            /* Estilos especiais por categoria — preservados exatamente como antes */
            let secId   = `sec-${cat.id}`;
            let title   = cat.nome;
            let bannerStyle = {margin:'0 16px 12px',cursor:'default'};
            let sectionStyle = {paddingTop:20,scrollMarginTop:20};
            let displayProds = catProds;

            if (nome.includes('destaque')) {
              secId = 'sec-destaques'; title = 'Destaques';
              sectionStyle = {paddingTop:12,scrollMarginTop:16};
              bannerStyle = {margin:'0 16px 12px',cursor:'default',
                background:'linear-gradient(120deg,#B45309 0%,#D97706 100%)',
                boxShadow:'0 4px 12px rgba(180,83,9,.25)'};
            } else if (nome.includes('combo')) {
              secId = 'sec-combos'; title = 'Combos';
              sectionStyle = {paddingTop:20,scrollMarginTop:20};
            } else if (nome.includes('fitness')) {
              secId = 'sec-fitness'; title = '💪 Pedido Fitness';
              sectionStyle = {paddingTop:20,scrollMarginTop:20};
              bannerStyle = {margin:'0 16px 12px',cursor:'default',
                background:'linear-gradient(120deg,#15803D 0%,#22C55E 100%)',
                boxShadow:'0 4px 12px rgba(21,128,61,.25)'};
            } else if (nome.includes('marmita')) {
              secId = 'sec-marmitas';
            } else if (nome.includes('pronto') || (nome.includes('copo') && !nome.includes('monte'))) {
              secId = 'sec-prontos';
            } else if (nome.includes('monte')) {
              secId = 'sec-monte';
            } else if (nome.includes('batidinha')) {
              secId = 'sec-batidinha';
            } else if (nome.includes('bebida')) {
              secId = 'sec-bebidas';
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
        <p>✨ Encanto – Açaí & Marmitas</p>
        <p style={{marginTop:4}}>📱 (38) 99220-3620</p>
      </div>
      </div>{/* /app-content */}

      {/* ── Modal de Seleção de Endereço ── */}
      {showAddressModal && (
        <AddressModal
          onClose={()=>setShowAddressModal(false)}
          onSelect={(addr, meta)=>{
            selecionarEndereco(addr, meta);   // dominio Address: grava endereco (+meta com lat)
            setShowAddressModal(false);
          }}
        />
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
