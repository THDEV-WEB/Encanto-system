import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppShell from './AppShell.jsx';
import './index.css';
import { WHATSAPP, LOGO } from './lib/supabase.js';
import { fmt, fmtDate } from './utils/format.js';
import { precoVitrine } from './utils/pricing.js'; /* eslint-disable-line no-unused-vars */ // TOKEN Regra F (deps.audit.mjs §F): App.jsx deve consumir pricing; consumidor real movido p/ components/admin/AdminProducts.jsx (Onda 6.4). NAO remover sem ajustar a Regra F.
import { resolverAdicionais, selecionarFonteAdicionais } from './utils/addons.js'; /* MOCK_ADS movido p/ components/admin/AdminAdicionais.jsx (Onda 7.1) */
import { prodInCat, getProdCatIds } from './utils/catalog.js';
import { STORAGE_KEYS } from './constants/storage.js';
import { DS } from './services/DataService.js';
import { useCategories } from './hooks/useCategories.js';
import { useProducts } from './hooks/useProducts.js';
import { useAdicionais } from './hooks/useAdicionais.js';
import { useCart } from './hooks/useCart.js';
import { Spinner } from './components/ui/Spinner.jsx';
import { ProductCard } from './components/ProductCard.jsx';
import { ProductModal } from './components/ProductModal/index.jsx';
import { CartSidebar } from './components/CartSidebar.jsx';
import { LazySection } from './components/ui/LazySection.jsx';
import { SuccessPage } from './components/checkout/SuccessPage.jsx';
import { CheckoutPage } from './components/checkout/CheckoutPage.jsx';
import { AdminLogin } from './components/admin/AdminLogin.jsx';
import { AdminCategorias } from './components/admin/AdminCategorias.jsx';
import { ImageUploader } from './components/admin/ImageUploader.jsx';
import { AdminProducts } from './components/admin/AdminProducts.jsx';
import { AdminAdicionais } from './components/admin/AdminAdicionais.jsx';
import { AdminPedidos } from './components/admin/AdminPedidos.jsx';
import { AdminDashboard } from './components/admin/AdminDashboard.jsx';
import { AdminStatus } from './components/admin/AdminStatus.jsx';

/* ============================================================
   ENCANTO DELIVERY — React 18 + Supabase v2
   (migrado para Vite: build real, sem Babel no browser)
   ============================================================ */

/* ── Helpers ─────────────────────────────────────────────────── */
/* CAT_EMOJI/catEmoji, isHttpUrl, CATEGORIAS_DESCONTINUADAS/isCategoriaDescontinuada,
   prodInCat, getProdCatIds → src/utils/catalog.js (REF-APP-01 · Onda 1) */

/* ── Mock Data ───────────────────────────────────────────────── */
/* MOCK_CATS / MOCK_PRODS → src/data/mockCatalog.js (REF-APP-01 · Onda 1) */
/* ── Domínio de adicionais → src/utils/addons.js (NORM-04) ──────────────────
   MOCK_ADS, CAT_ADDON_GROUP, marmitaPermitido, gruposDoProduto,
   selecionarFonteAdicionais (seam NORM-05), resolverAdicionais (ex-getAdicionaisProd),
   agruparPorGrupo (ex-getAdsByGrupo), ehAdicionalGratis, cotaGratis,
   resolverPrecoAdicionais e ADICIONAL_SIMPLES_PRECO vivem agora em ./utils/addons.js. */


/* CATEGORIAS_DESCONTINUADAS / isCategoriaDescontinuada → src/utils/catalog.js (REF-APP-01 · Onda 1) */

/* PRODUCTS_PAGE_SIZE / PRODUCTS_PAGINATE / PRODUCTS_CACHE_TTL → src/constants/catalogConfig.js (REF-APP-01 · Onda 1) */

/* ── DataService → src/services/DataService.js (REF-APP-01 · Onda 2, move puro) ── */

/* ── Hooks ───────────────────────────────────────────────────── */
/* useCategories → src/hooks/useCategories.js (REF-APP-01 · Onda 3) */

/* _prodCache (Map de sessão) + useProducts → src/hooks/useProducts.js (REF-APP-01 · Onda 3) */

/* filterMock → src/data/mockCatalog.js (REF-APP-01 · Onda 1) */

/* prodInCat / getProdCatIds → src/utils/catalog.js (REF-APP-01 · Onda 1) */

/* isUuid / newRequestId → src/utils/ids.js (REF-APP-01 · Onda 1) */

/* useProducts → src/hooks/useProducts.js (REF-APP-01 · Onda 3) */

/* useAdicionais → src/hooks/useAdicionais.js (REF-APP-01 · Onda 3) */

/* useOrders → src/hooks/useOrders.js (REF-APP-01 · Onda 3) */

/* useCart → src/hooks/useCart.js (REF-APP-01 · Onda 3) */

/* ── UI Components ───────────────────────────────────────────── */
/* Spinner → src/components/ui/Spinner.jsx (REF-APP-01 · Onda 4) */

/* BADGE_MAP + ProductCard → src/components/ProductCard.jsx (REF-APP-01 · Onda 4) */

/* ProductModalInner -> src/components/ProductModal/ProductModalInner.jsx (REF-APP-01 Onda 4) */


/* ProductModalBoundary → src/components/ProductModal/ProductModalBoundary.jsx (REF-APP-01 · Onda 4) */
/* ProductModal → src/components/ProductModal/index.jsx (REF-APP-01 · Onda 4) */
/* CartSidebar -> src/components/CartSidebar.jsx (REF-APP-01 Onda 4) */

/* CheckoutPage -> src/components/checkout/CheckoutPage.jsx (REF-APP-01 Onda 5.3) */

/* SuccessPage -> src/components/checkout/SuccessPage.jsx (REF-APP-01 Onda 5.1) */

/* ── Admin Components ────────────────────────────────────────── */
/* AdminLogin → src/components/admin/AdminLogin.jsx (REF-APP-01 · Onda 6.1) */

/* AdminCategorias → src/components/admin/AdminCategorias.jsx (REF-APP-01 · Onda 6.2) */

/* ImageUploader → src/components/admin/ImageUploader.jsx (REF-APP-01 · Onda 6.3) */

/* AdminProducts (+ ImageUploader) → src/components/admin/AdminProducts.jsx (REF-APP-01 · Onda 6.4) */

/* ── Admin operações (REF-APP-01 · Onda 7) ───────────────────── */
/* AdminAdicionais → src/components/admin/AdminAdicionais.jsx (REF-APP-01 · Onda 7.1) */
/* AdminPedidos → src/components/admin/AdminPedidos.jsx (REF-APP-01 · Onda 7.2) */
/* AdminDashboard → src/components/admin/AdminDashboard.jsx (REF-APP-01 · Onda 7.3) */
/* AdminStatus → src/components/admin/AdminStatus.jsx (REF-APP-01 · Onda 7.4) */

/* ── Admin: Fidelidade ─────────────────────────────────── */
function AdminFidelidade() {
  const [count,    setCount]    = useState(()=>parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_COUNT)||'0'));
  const [required, setRequired] = useState(()=>parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_REQUIRED)||'10'));
  const [discount, setDiscount] = useState(()=>parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_DISCOUNT)||'50'));
  const [enabled,  setEnabled]  = useState(()=>localStorage.getItem(STORAGE_KEYS.LOYALTY_ENABLED)!=='false');
  const [saved,    setSaved]    = useState(false);
  const [editReq,  setEditReq]  = useState(false);
  const [editDis,  setEditDis]  = useState(false);
  const rewardAvail = count >= required;

  const saveConfig = () => {
    localStorage.setItem(STORAGE_KEYS.LOYALTY_REQUIRED, String(required));
    localStorage.setItem(STORAGE_KEYS.LOYALTY_DISCOUNT,  String(discount));
    localStorage.setItem(STORAGE_KEYS.LOYALTY_ENABLED,   String(enabled));
    setSaved(true); setEditReq(false); setEditDis(false);
    setTimeout(()=>setSaved(false), 2500);
  };

  const resetCounter = () => {
    if (!window.confirm(
      'Zerar o contador de pedidos?\nEsta ação representa que o cliente usou sua recompensa ou foi feito um ajuste manual.'
    )) return;
    localStorage.setItem(STORAGE_KEYS.LOYALTY_COUNT, '0');
    localStorage.setItem(STORAGE_KEYS.LOYALTY_REWARD_USED,'true');
    setCount(0);
  };

  const addPedido = () => {
    if (count >= required) { alert('Recompensa já disponível. Peça para o cliente usar o desconto antes de adicionar novos pedidos.'); return; }
    const next = count + 1;
    localStorage.setItem(STORAGE_KEYS.LOYALTY_COUNT, String(next));
    setCount(next);
  };

  return (
    <div>
      {/* ── Cabeçalho com status ── */}
      <div style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',
        flexWrap:'wrap',gap:12,marginBottom:20,
        padding:'16px 20px',background:'var(--white)',
        borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-sm)',
      }}>
        <div>
          <h2 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,margin:0}}>
            🎁 Programa de Fidelidade
          </h2>
          <p style={{fontSize:13,color:'var(--gray-500)',marginTop:4}}>
            Regra: {required} pedidos = {discount}% de desconto
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{
            fontSize:12,fontWeight:700,
            color: enabled ? '#15803D' : 'var(--gray-500)',
            background: enabled ? '#F0FDF4' : 'var(--gray-100)',
            padding:'4px 12px',borderRadius:20,
          }}>
            {enabled ? '● Ativo' : '○ Desativado'}
          </span>
          <label className="toggle-switch">
            <input type="checkbox" checked={enabled} onChange={e=>{
              setEnabled(e.target.checked);
              localStorage.setItem(STORAGE_KEYS.LOYALTY_ENABLED,String(e.target.checked));
            }}/>
            <span className="toggle-slider"/>
          </label>
        </div>
      </div>

      {/* ── Progresso do cliente ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>📊 Progresso atual</h3>
          <div style={{display:'flex',gap:8}}>
            <button className="btn-sm" onClick={addPedido} title="Adicionar 1 pedido manualmente">
              + Pedido
            </button>
            <button className="btn-danger" onClick={resetCounter}>
              ↺ Resetar
            </button>
          </div>
        </div>
        <div style={{padding:'20px'}}>
          {/* Card de status */}
          <div style={{
            display:'flex',alignItems:'center',gap:16,
            padding:'18px',borderRadius:14,marginBottom:16,
            background: rewardAvail ? '#F0FDF4' : 'var(--grape-pale)',
            border: `1.5px solid ${rewardAvail?'#BBF7D0':'#DDD6FE'}`,
          }}>
            <div style={{
              width:64,height:64,borderRadius:14,flexShrink:0,
              background: rewardAvail ? '#16A34A' : '#6B21A8',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:28,boxShadow:`0 4px 12px ${rewardAvail?'rgba(22,163,74,.3)':'rgba(107,33,168,.3)'}`,
            }}>
              {rewardAvail ? '🎉' : '🛍️'}
            </div>
            <div style={{flex:1}}>
              <div style={{
                fontFamily:'var(--font-head)',fontSize:32,fontWeight:800,lineHeight:1,
                color: rewardAvail ? '#15803D' : '#6B21A8',
              }}>
                {count}
                <span style={{fontSize:16,fontWeight:500,color:'var(--gray-400)',marginLeft:4}}>
                  / {required} pedidos
                </span>
              </div>
              <div style={{fontSize:13,marginTop:6,fontWeight:600,
                color: rewardAvail ? '#15803D' : 'var(--grape)'}}>
                {rewardAvail
                  ? '🎁 Recompensa disponível! Cliente pode usar o desconto.'
                  : `Faltam ${required-count} pedido(s) para ${discount}% de desconto`}
              </div>
            </div>
          </div>

          {/* Barra */}
          <div style={{marginBottom:4}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-400)',marginBottom:6}}>
              <span>order_count: {count} | reward_available: {rewardAvail?'true':'false'}</span>
              <span>{Math.round((count/required)*100)}%</span>
            </div>
            <div style={{width:'100%',height:12,background:'var(--gray-100)',borderRadius:6,overflow:'hidden'}}>
              <div style={{
                height:'100%',borderRadius:6,
                width:`${Math.min(100,(count/required)*100)}%`,
                background: rewardAvail
                  ? 'linear-gradient(90deg,#16A34A,#4ADE80)'
                  : 'linear-gradient(90deg,#6B21A8,#A855F7)',
                transition:'width .4s',
              }}/>
            </div>
          </div>

          {/* Grade de pedidos */}
          <div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:16}}>
            {Array.from({length:required}).map((_,i)=>(
              <div key={i} style={{
                width:34,height:34,borderRadius:8,
                background: i<count ? 'linear-gradient(135deg,#6B21A8,#A855F7)' : 'var(--gray-100)',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:14,border: i<count ? 'none' : '1px solid var(--gray-200)',
                boxShadow: i<count ? '0 2px 6px rgba(107,33,168,.25)' : 'none',
                title:`Pedido ${i+1}`,
              }}>
                {i<count ? '🛍️' : <span style={{color:'var(--gray-300)'}}>○</span>}
              </div>
            ))}
          </div>

          <p style={{fontSize:11,color:'var(--gray-400)',marginTop:12,lineHeight:1.5}}>
            <b>+Pedido</b>: adiciona 1 pedido manualmente (ex: aprovado pelo sistema).
            <b> Resetar</b>: zera o contador (ex: cliente usou o desconto).
            Os campos <code>order_count</code> e <code>reward_available</code> refletem o estado atual.
          </p>
        </div>
      </div>

      {/* ── Configurações ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>⚙️ Configurações do Programa</h3>
          {saved && <span style={{color:'#16A34A',fontSize:13,fontWeight:700}}>✓ Salvo com sucesso!</span>}
        </div>
        <div style={{padding:'20px'}}>
          <div className="form-row" style={{marginBottom:20}}>
            <div className="form-group">
              <label className="form-label">Pedidos para recompensa</label>
              <input className="form-input" type="number" min="1" max="100"
                value={required} onChange={e=>setRequired(+e.target.value)}/>
              <span style={{fontSize:11,color:'var(--gray-400)',marginTop:3,display:'block'}}>
                Campo: <code>order_count</code> — padrão: 10
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Desconto da recompensa (%)</label>
              <input className="form-input" type="number" min="1" max="100"
                value={discount} onChange={e=>setDiscount(+e.target.value)}/>
              <span style={{fontSize:11,color:'var(--gray-400)',marginTop:3,display:'block'}}>
                Campo: <code>reward_discount</code> — padrão: 50
              </span>
            </div>
          </div>
          <div style={{
            padding:'12px 16px',background:'var(--gray-50)',borderRadius:10,
            marginBottom:20,fontSize:13,color:'var(--gray-600)',lineHeight:1.6,
          }}>
            <b>Lógica aplicada:</b><br/>
            • <code>order_count ≥ {required}</code> → <code>reward_available = true</code><br/>
            • Ao usar o desconto: <code>order_count = 0</code>, <code>reward_available = false</code>, <code>reward_used = true</code><br/>
            • Valor do frete não é contabilizado — somente products.<br/>
            • Recompensas não são cumulativas (1 por ciclo).
          </div>
          <button className="btn-primary" onClick={saveConfig} style={{minWidth:160}}>
            {saved ? '✓ Salvo!' : '💾 Salvar configurações'}
          </button>
        </div>
      </div>

      {/* ── Regulamento resumido ── */}
      <div className="admin-card">
        <div className="admin-card-header"><h3>📋 Regulamento do Programa</h3></div>
        <div style={{padding:'20px'}}>
          {[
            ['Elegibilidade','Para participar, o cliente deve possuir cadastro ativo. Em caso de uso indevido ou fraude, a loja pode cancelar os benefícios.'],
            ['Contabilização','O pedido só contabiliza após ser aprovado ou finalizado pela loja. O valor do frete não é contabilizado.'],
            ['Recompensa','Peça 10 vezes e ganhe 50% de desconto no próximo pedido. O resgate só pode ser feito pelo próprio participante.'],
            ['Validade','O programa é válido por tempo indeterminado. A loja pode alterar regras, duração ou benefícios a qualquer momento.'],
            ['Encerramento','Em caso de encerramento, pontos e recompensas poderão ser zerados.'],
          ].map(([t,d])=>(
            <div key={t} style={{
              display:'flex',gap:12,padding:'12px 0',
              borderBottom:'1px solid var(--gray-100)',
            }}>
              <div style={{
                fontSize:12,fontWeight:700,color:'var(--amarelo)',
                minWidth:110,flexShrink:0,paddingTop:1,
              }}>{t}</div>
              <div style={{fontSize:13,color:'var(--gray-600)',lineHeight:1.55}}>{d}</div>
            </div>
          ))}
          <div style={{
            display:'flex',gap:12,padding:'12px 0',
          }}>
            <div style={{fontSize:12,fontWeight:700,color:'var(--amarelo)',minWidth:110,flexShrink:0}}>Contato</div>
            <div style={{fontSize:13,color:'var(--gray-600)'}}>
              <a href="https://wa.me/5538992203620" target="_blank"
                style={{color:'var(--amarelo)',fontWeight:600}}>
                WhatsApp: (38) 99220-3620
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* HARDEN-06: painel de Saúde/Observabilidade — consome orders_health() (só agregados, sem PII). */
function AdminHealth() {
  const [h, setH]             = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async()=>{ setLoading(true); setH(await DS.getHealth()); setLoading(false); },[]);
  useEffect(()=>{ load(); },[load]);
  const Card = ({icon,val,label,color}) => (
    <div className="stat-card" style={{borderTop:`3px solid ${color}`}}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-val">{val}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
  return (
    <div>
      <div className="admin-card-header" style={{marginBottom:12}}>
        <h3>🩺 Saúde do Sistema</h3>
        <button className="btn-secondary" onClick={load}>🔄 Atualizar</button>
      </div>
      {loading ? <Spinner/> : !h ? (
        <div className="empty-state"><div className="icon">🩺</div><p>Sem dados de saúde</p></div>
      ) : (
        <>
          <div className="stat-cards" style={{gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))'}}>
            <Card icon="🌅" val={h.pedidos_hoje}           label="Pedidos hoje"     color="var(--grape)"/>
            <Card icon="💰" val={fmt(h.faturamento_hoje)}  label="Faturamento hoje" color="#16A34A"/>
            <Card icon="📊" val={fmt(h.ticket_medio_hoje)} label="Ticket médio"     color="#0891B2"/>
            <Card icon="📦" val={h.pedidos_total}          label="Total geral"      color="var(--gray-300)"/>
            <Card icon="⚠️" val={h.erros_24h}              label="Erros 24h"        color="var(--orange)"/>
            <Card icon="🧮" val={h.divergencias}           label="Divergências"     color={h.divergencias>0?'#DC2626':'#16A34A'}/>
          </div>
          {Array.isArray(h.serie_7d) && h.serie_7d.length>0 && (
            <div style={{marginTop:20}}>
              <div className="stat-label" style={{marginBottom:8}}>
                Pedidos/dia (7 dias) · Taxa de erro 24h: <b>{h.taxa_erro_pct}%</b>
              </div>
              <div style={{display:'flex',alignItems:'flex-end',gap:6,height:90}}>
                {(()=>{ const max=Math.max(1,...h.serie_7d.map(x=>Number(x.n)||0));
                  return h.serie_7d.map((d,i)=>(
                    <div key={i} style={{flex:1,textAlign:'center'}}>
                      <div style={{height:`${((Number(d.n)||0)/max)*60}px`,minHeight:2,background:'var(--grape)',borderRadius:4,marginBottom:4}} title={String(d.n)}/>
                      <div style={{fontSize:11,fontWeight:700}}>{Number(d.n)||0}</div>
                      <div style={{fontSize:10,color:'var(--gray-500)'}}>{d.dia}</div>
                    </div>
                  )); })()}
              </div>
            </div>
          )}
          <div style={{marginTop:16,fontSize:12,color:'var(--gray-500)'}}>
            Pedidos 7d: {h.pedidos_7d} · 24h: {h.pedidos_24h} · Logs: {h.logs_total} · Atualizado: {fmtDate(h.gerado_em)}
          </div>
        </>
      )}
    </div>
  );
}

function AdminPanel({ onExit }) {
  const [tab, setTab] = useState('dashboard');
  const tabs = [
    {id:'dashboard', icon:'📊', label:'Dashboard'},
    {id:'pedidos',   icon:'📋', label:'Pedidos'},
    {id:'products',  icon:'🛍️', label:'products'},
    {id:'categorias',icon:'🏷️', label:'Categorias'},
    {id:'adicionais',icon:'➕', label:'Adicionais'},
    {id:'status',    icon:'🏪', label:'Status'},
    {id:'fidelidade',icon:'🎁', label:'Fidelidade'},
    {id:'saude',     icon:'🩺', label:'Saúde'},
  ];
  const titles = {dashboard:'Dashboard',pedidos:'Pedidos',products:'Products',categorias:'Categorias',adicionais:'Adicionais',status:'Status da Loja',fidelidade:'Fidelidade',saude:'Saúde do Sistema'};
  return (
    <div className="admin-layout">
      <div className="admin-sidebar">
        <div className="admin-logo">✨ <span>Encanto</span></div>
        <nav className="admin-nav">
          {tabs.map(t=>(
            <div key={t.id} className={`admin-nav-item ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </nav>
        <div style={{padding:'16px 8px'}}>
          <div className="admin-nav-item" onClick={onExit} style={{color:'rgba(255,255,255,.5)'}}>
            <span className="nav-icon">🚪</span><span>Sair</span>
          </div>
        </div>
      </div>
      <div className="admin-content">
        <div className="admin-top">
          <h1>{titles[tab]}</h1>
          <button className="admin-exit" onClick={onExit}>← Ver loja</button>
        </div>
        <div className="admin-body">
          {tab==='dashboard'  && <AdminDashboard/>}
          {tab==='pedidos'    && <AdminPedidos/>}
          {tab==='products'   && <AdminProducts/>}
          {tab==='categorias' && <AdminCategorias/>}
          {tab==='adicionais' && <AdminAdicionais/>}
          {tab==='status'     && <AdminStatus/>}
          {tab==='fidelidade' && <AdminFidelidade/>}
          {tab==='saude'      && <AdminHealth/>}
        </div>
      </div>
    </div>
  );
}

/* ── StoreApp ────────────────────────────────────────────────── */

/* ── LazySection: renderiza filhos apenas quando seção entra na tela ── */
/* LazySection -> src/components/ui/LazySection.jsx (REF-APP-01 Onda 4) */

/* ── AddressModal: busca profissional com ViaCEP + Nominatim + Leaflet ── */
function AddressModal({ onClose, onSelect }) {
  const { useState: us, useEffect: ue, useCallback: ucb, useRef: ur } = React;

  const [tab,         setTab]         = us('search');   // search | cep | map
  const [query,       setQuery]        = us('');
  const [numero,      setNumero]       = us('');
  const [complemento, setComplemento]  = us('');
  const [suggestions, setSuggestions]  = us([]);
  const [status,      setStatus]       = us('idle');    // idle|loading|found|notfound|gps|outrange
  const [cepQuery,    setCepQuery]     = us('');
  const [cepData,     setCepData]      = us(null);
  const [cepNumero,   setCepNumero]    = us('');
  const [mapPin,      setMapPin]       = us({lat:-26.795,lng:-49.270});
  const [mapAddr,     setMapAddr]      = us('');
  const inputRef = ur(null);
  const mapRef   = ur(null);
  const leafRef  = ur(null);

  /* Área de entrega: raio ~15km de Timbó (aproximação por bounding box) */
  const inRange = (lat, lng) => lat>=-27.0&&lat<=-26.5&&lng>=-49.5&&lng>=-49.0;

  ue(()=>{ if(tab==='search') inputRef.current?.focus(); },[tab]);

  /* ── Leaflet: inicializar mapa ao entrar na aba mapa ── */
  ue(()=>{
    if (tab!=='map') return;
    const init = () => {
      if (!window.L || !mapRef.current || leafRef.current) return;
      const map = window.L.map(mapRef.current).setView([mapPin.lat, mapPin.lng], 15);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'© OpenStreetMap'
      }).addTo(map);
      const marker = window.L.marker([mapPin.lat, mapPin.lng],{draggable:true}).addTo(map);
      marker.on('dragend', async e => {
        const {lat,lng} = e.target.getLatLng();
        setMapPin({lat,lng});
        try {
          const r = await fetch(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',
            {headers:{'Accept-Language':'pt-BR'}}
          );
          const d = await r.json();
          const a = d.address||{};
          const addr = [a.road,a.house_number,a.suburb||a.neighbourhood,a.city||a.town]
            .filter(Boolean).join(', ');
          setMapAddr(addr || d.display_name?.split(',').slice(0,3).join(',') || '');
        } catch { setMapAddr(''); }
      });
      map.on('click', async e => {
        const {lat,lng} = e.latlng;
        marker.setLatLng([lat,lng]);
        setMapPin({lat,lng});
        try {
          const r = await fetch(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',
            {headers:{'Accept-Language':'pt-BR'}}
          );
          const d = await r.json();
          const a = d.address||{};
          const addr = [a.road,a.house_number,a.suburb||a.neighbourhood,a.city||a.town]
            .filter(Boolean).join(', ');
          setMapAddr(addr || '');
        } catch { setMapAddr(''); }
      });
      leafRef.current = map;
    };
    if (window.L) { setTimeout(init, 50); return; }
    /* Carregar Leaflet dinamicamente */
    const css = document.createElement('link');
    css.rel='stylesheet'; css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = ()=>setTimeout(init, 50);
    document.head.appendChild(js);
    return ()=>{ if(leafRef.current){leafRef.current.remove();leafRef.current=null;} };
  },[tab]);

  /* ── Busca por CEP via ViaCEP (API brasileira oficial) ── */
  const buscarCEP = ucb(async (cep) => {
    const c = cep.replace(/\D/g,'');
    if (c.length !== 8) return;
    setStatus('loading');
    try {
      const r = await fetch('https://viacep.com.br/ws/'+c+'/json/');
      const d = await r.json();
      if (d.erro) { setStatus('notfound'); setCepData(null); return; }
      setCepData(d);
      setStatus('found');
      setCepNumero('');
    } catch { setStatus('notfound'); setCepData(null); }
  },[]);

  ue(()=>{
    const t = setTimeout(()=>buscarCEP(cepQuery), 400);
    return ()=>clearTimeout(t);
  },[cepQuery, buscarCEP]);

  const confirmCEP = () => {
    if (!cepData || !cepNumero.trim()) { alert('Informe o número da residência.'); return; }
    const short = `${cepData.logradouro}, ${cepNumero.trim()}${complemento?' '+complemento:''} — ${cepData.bairro}`;
    onSelect(short, {
      rua: cepData.logradouro, numero: cepNumero.trim(),
      bairro: cepData.bairro, cidade: cepData.localidade,
      estado: cepData.uf, cep: cepData.cep,
      complemento: complemento,
    });
  };

  /* ── Busca por rua/nome via Nominatim multi-estratégia ── */
  const searchAddress = ucb(async (q) => {
    if (!q || q.length < 3) { setSuggestions([]); setStatus('idle'); return; }
    setStatus('loading');
    const NOM = 'https://nominatim.openstreetmap.org/search';
    const H   = {'Accept-Language':'pt-BR'};
    const numM  = q.match(/(\d+)/);
    const num   = numM ? numM[1] : '';
    const semN  = q.replace(/\d+/g,'').replace(/[-,]/g,' ').trim();
    const urls  = [
      NOM+'?format=json&q='+encodeURIComponent(q+', Timbó, SC, Brasil')+'&limit=6&addressdetails=1&countrycodes=br',
      num && semN.length>2
        ? NOM+'?format=json&street='+encodeURIComponent(num+' '+semN)+'&city=Timb%C3%B3&state=Santa+Catarina&country=Brasil&format=json&addressdetails=1&limit=5'
        : null,
      semN.length>3
        ? NOM+'?format=json&q='+encodeURIComponent(semN+', Timbó, SC')+'&limit=5&addressdetails=1&countrycodes=br'
        : null,
    ].filter(Boolean);
    try {
      let res=[];
      for(const u of urls){ if(res.length>0)break; const r=await fetch(u,{headers:H}); const d=await r.json(); res=Array.isArray(d)?d:[]; }
      const seen=new Set();
      res=res.filter(s=>{ const k=(s.address?.road||'')+','+(s.address?.house_number||''); if(seen.has(k))return false; seen.add(k);return true; });
      if(res.length>0){setSuggestions(res);setStatus('found');}
      else{setSuggestions([]);setStatus('notfound');}
    } catch { setSuggestions([]); setStatus('notfound'); }
  },[]);

  ue(()=>{ const t=setTimeout(()=>searchAddress(query),450); return()=>clearTimeout(t); },[query,searchAddress]);

  /* ── GPS ── */
  const useGPS = () => {
    if(!navigator.geolocation){alert('GPS indisponível.');return;}
    setStatus('gps');
    navigator.geolocation.getCurrentPosition(async pos=>{
      const {latitude:lat,longitude:lng}=pos.coords;
      try {
        const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',{headers:{'Accept-Language':'pt-BR'}});
        const d=await r.json(); const a=d.address||{};
        const short=[a.road,a.house_number].filter(Boolean).join(', ')||d.display_name?.split(',')[0]||'';
        const bairro=a.suburb||a.neighbourhood||''; const cidade=a.city||a.town||'Timbó';
        onSelect(short+( bairro?' — '+bairro:''), {lat,lng,rua:a.road||'',numero:a.house_number||'',bairro,cidade,estado:a.state||'SC',cep:a.postcode||''});
      } catch { onSelect(lat.toFixed(5)+', '+lng.toFixed(5),{lat,lng}); }
    },()=>{ setStatus('idle'); alert('Não foi possível obter a localização.'); });
  };

  /* ── Selecionar sugestão ── */
  const pick = (s) => {
    const a=s.address||{};
    const rua=a.road||''; const num=a.house_number||''; const bairro=a.suburb||a.neighbourhood||a.quarter||'';
    const cidade=a.city||a.town||a.municipality||'Timbó'; const cep=a.postcode||''; const estado=a.state||'SC';
    const short=[rua+( num?', '+num:''), bairro].filter(Boolean).join(' — ') || s.display_name.split(',').slice(0,2).join(',').trim();
    onSelect(short, {lat:parseFloat(s.lat),lng:parseFloat(s.lon),rua,numero:num,bairro,cidade,estado,cep,full:s.display_name});
  };

  /* ── Confirmar pelo mapa ── */
  const confirmMap = async () => {
    if(!mapAddr.trim()&&!cepNumero.trim()){
      const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+mapPin.lat+'&lon='+mapPin.lng+'&addressdetails=1',{headers:{'Accept-Language':'pt-BR'}});
      const d=await r.json(); const a=d.address||{};
      const addr=[a.road,a.house_number,a.suburb,a.city||a.town].filter(Boolean).join(', ');
      onSelect(addr||'Localização no mapa',{lat:mapPin.lat,lng:mapPin.lng});
    } else {
      onSelect(mapAddr||('Lat '+mapPin.lat.toFixed(5)),{lat:mapPin.lat,lng:mapPin.lng});
    }
  };

  /* ── UI ── */
  const TABS=[{id:'search',label:'🔍 Buscar endereço'},{id:'cep',label:'📮 Buscar por CEP'},{id:'map',label:'🗺️ Ver no mapa'}];

  return (
    <div className="addr-modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="addr-modal" style={{maxWidth:500}}>

        {/* Header */}
        <div className="addr-modal-head">
          <span className="addr-modal-title">📍 Onde receber seu pedido?</span>
          <button className="addr-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Abas */}
        <div style={{display:'flex',borderBottom:'1px solid var(--gray-100)',background:'var(--gray-50)'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flex:1,padding:'10px 4px',border:'none',background:'none',cursor:'pointer',
              fontSize:11,fontWeight:700,fontFamily:'var(--font-body)',
              borderBottom: tab===t.id ? '2px solid var(--grape)' : '2px solid transparent',
              color: tab===t.id ? 'var(--grape)' : 'var(--gray-500)',
              transition:'all .15s',
            }}>{t.label}</button>
          ))}
        </div>

        <div className="addr-modal-body">

          {/* ── ABA: Buscar por nome/rua ── */}
          {tab==='search' && (
            <>
              <input ref={inputRef} className="addr-search-input"
                placeholder="Rua, número, bairro ou local..." value={query}
                onChange={e=>setQuery(e.target.value)}/>
              <button className="addr-gps-btn" onClick={useGPS}>
                {status==='gps'
                  ? <><span style={{display:'inline-block',animation:'spin .8s linear infinite'}}>⏳</span> Obtendo localização...</>
                  : <><span>🎯</span> Usar minha localização atual</>}
              </button>
              {status==='loading' && (
                <div style={{textAlign:'center',padding:'20px',color:'var(--gray-400)'}}>
                  <div className="spinner" style={{margin:'0 auto 8px'}}/><p style={{fontSize:13}}>Buscando...</p>
                </div>
              )}
              {status==='found' && (
                <div className="addr-suggestions" style={{marginTop:10}}>
                  {suggestions.map((s,i)=>{
                    const a=s.address||{};
                    const main=[a.road,a.house_number].filter(Boolean).join(', ')||s.display_name.split(',')[0];
                    const sub=[a.suburb||a.neighbourhood,a.city||a.town,a.postcode?'CEP '+a.postcode:''].filter(Boolean).join(' · ');
                    return (
                      <div key={i} className="addr-suggestion-item" onClick={()=>pick(s)}>
                        <span className="addr-suggestion-icon">📍</span>
                        <div className="addr-suggestion-text">
                          <div className="addr-suggestion-main">{main}</div>
                          {sub&&<div className="addr-suggestion-sub">{sub}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {status==='notfound' && (
                <div className="addr-not-found">
                  <div style={{fontSize:28,marginBottom:6}}>🔍</div>
                  <p><b>Endereço não encontrado.</b><br/>Tente buscar pelo CEP ou marque no mapa.</p>
                  <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',marginTop:10}}>
                    <button className="addr-map-btn" onClick={()=>setTab('cep')}>📮 Buscar por CEP</button>
                    <button className="addr-map-btn" onClick={()=>setTab('map')}>🗺️ Ver no mapa</button>
                  </div>
                </div>
              )}
              {status==='idle' && !query && (
                <div style={{marginTop:12}}>
                  <div className="addr-section-label">Dicas de busca</div>
                  <div style={{fontSize:12,color:'var(--gray-500)',lineHeight:1.8,padding:'4px 0'}}>
                    • Ex: <b>Rua das Flores, 123</b><br/>
                    • Ex: <b>João Schlay 77</b><br/>
                    • Ex: <b>Testo Central, Timbó</b>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── ABA: Buscar por CEP ── */}
          {tab==='cep' && (
            <>
              <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:6}}>
                CEP
              </label>
              <input className="addr-search-input"
                placeholder="00000-000"
                value={cepQuery}
                maxLength={9}
                onChange={e=>{
                  let v=e.target.value.replace(/\D/g,'');
                  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5,8);
                  setCepQuery(v); setStatus('idle'); setCepData(null);
                }}/>
              {status==='loading' && (
                <div style={{textAlign:'center',padding:'16px',color:'var(--gray-400)'}}>
                  <div className="spinner" style={{margin:'0 auto 8px'}}/><p style={{fontSize:13}}>Buscando CEP...</p>
                </div>
              )}
              {status==='found' && cepData && (
                <div style={{marginTop:12}}>
                  <div style={{
                    background:'var(--grape-pale)',borderRadius:10,padding:'12px 14px',
                    border:'1px solid #DDD6FE',marginBottom:12,
                  }}>
                    <div style={{fontWeight:700,fontSize:14,color:'var(--amarelo)',marginBottom:4}}>
                      ✅ CEP encontrado
                    </div>
                    <div style={{fontSize:13,color:'var(--gray-700)',lineHeight:1.7}}>
                      <b>{cepData.logradouro}</b><br/>
                      {cepData.bairro} · {cepData.localidade}/{cepData.uf}
                    </div>
                  </div>
                  <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:4}}>
                    Número da residência <span style={{color:'var(--orange)'}}>*</span>
                  </label>
                  <input className="addr-search-input" style={{marginBottom:8}}
                    placeholder="Ex: 77" value={cepNumero}
                    onChange={e=>setCepNumero(e.target.value)}/>
                  <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:4}}>
                    Complemento (opcional)
                  </label>
                  <input className="addr-search-input" style={{marginBottom:12}}
                    placeholder="Ex: Casa 02, Ap 301" value={complemento}
                    onChange={e=>setComplemento(e.target.value)}/>
                  <button className="addr-confirm-btn" onClick={confirmCEP}>
                    ✅ Confirmar endereço
                  </button>
                </div>
              )}
              {status==='notfound' && (
                <div className="addr-not-found" style={{marginTop:16}}>
                  <p>CEP não encontrado. Verifique e tente novamente.</p>
                </div>
              )}
            </>
          )}

          {/* ── ABA: Mapa Leaflet interativo ── */}
          {tab==='map' && (
            <>
              <p style={{fontSize:12,color:'var(--gray-500)',marginBottom:8,lineHeight:1.5}}>
                Clique ou arraste o marcador para marcar seu endereço.
              </p>
              <div className="addr-map-container" style={{height:300}}>
                <div ref={mapRef} style={{width:'100%',height:'100%'}}/>
              </div>
              {mapAddr && (
                <div style={{
                  marginTop:8,padding:'8px 12px',background:'var(--grape-pale)',
                  borderRadius:8,fontSize:13,color:'var(--amarelo)',fontWeight:600,
                }}>
                  📍 {mapAddr}
                </div>
              )}
              <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',margin:'10px 0 4px'}}>
                Número da residência
              </label>
              <input className="addr-search-input" style={{marginBottom:10}}
                placeholder="Ex: 77" value={cepNumero}
                onChange={e=>setCepNumero(e.target.value)}/>
              <button className="addr-confirm-btn" onClick={confirmMap}>
                ✅ Confirmar localização no mapa
              </button>
              <p style={{fontSize:10,color:'var(--gray-400)',textAlign:'center',marginTop:6}}>
                Lat: {mapPin.lat.toFixed(5)} · Lng: {mapPin.lng.toFixed(5)}
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

/* ── SearchBar: dropdown de categorias robusto ──────────── */
function SearchBar({ cats, search, setSearch, setSelCat }) {
  const [open, setOpen]     = React.useState(false);
  const wrapRef             = React.useRef(null);

  /* Fechar ao clicar fora do componente inteiro */
  React.useEffect(()=>{
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return ()=>{
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  /* Fechar ao pressionar ESC */
  React.useEffect(()=>{
    const esc = (e) => { if (e.key==='Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return ()=>document.removeEventListener('keydown', esc);
  }, []);

  const getCatSecId = (nome) => {
    const n = (nome||'').toLowerCase();
    if (n.includes('combo'))     return 'sec-combos';
    if (n.includes('batidinha')) return 'sec-batidinha';
    if (n.includes('destaque'))  return 'sec-destaques';
    if (n.includes('monte'))     return 'sec-monte';
    if (n.includes('pronto'))    return 'sec-prontos';
    if (n.includes('marmita'))   return 'sec-marmitas';
    if (n.includes('açaí')||n.includes('acai')) return 'sec-acai';
    if (n.includes('bebida'))    return 'sec-bebidas';
    return null;
  };

  const handleCatClick = (cat) => {
    setOpen(false);
    setSearch('');
    setSelCat(cat.id);
  };

  return (
    <div className="search-bar" ref={wrapRef}>
      <div className="search-wrapper">
        <div className="search-inner" onClick={()=>{ if(!search) setOpen(o=>!o); }}>
          <span className="search-icon">🔍</span>
          <input
            placeholder={open && !search ? 'Escolha uma categoria ou busque...' : 'Buscar açaí, marmitas, combos...'}
            value={search}
            onChange={e=>{
              setSearch(e.target.value);
              setSelCat(null);
              setOpen(false);
            }}
            onFocus={()=>{ if(!search) setOpen(true); }}
          />
          {search && (
            <button
              onClick={e=>{ e.stopPropagation(); setSearch(''); setOpen(false); }}
              style={{color:'var(--gray-400)',fontSize:18,background:'none',border:'none',cursor:'pointer'}}>
              ✕
            </button>
          )}
          {!search && (
            <span style={{
              fontSize:18,color:'var(--gray-400)',transition:'transform .2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              lineHeight:1, flexShrink:0,
            }}>⌄</span>
          )}
        </div>

        {/* Dropdown — permanece aberto até clicar fora ou pressionar ESC */}
        {open && !search && (
          <div className="cat-dropdown" role="listbox" aria-label="Categorias">
            <div style={{
              padding:'8px 16px 6px',fontSize:11,fontWeight:700,
              color:'var(--gray-400)',letterSpacing:'.6px',textTransform:'uppercase',
              borderBottom:'1px solid var(--gray-100)',
            }}>
              Categorias
            </div>
            {cats.map(cat => (
              <div
                key={cat.id}
                className="cat-drop-item"
                role="option"
                tabIndex={0}
                /* mousedown antes do blur — não perde o foco antes de registrar o clique */
                onMouseDown={e=>e.preventDefault()}
                onClick={()=>handleCatClick(cat)}
                onKeyDown={e=>{ if(e.key==='Enter'||e.key===' ') handleCatClick(cat); }}
              >
                <span className="cat-drop-icon">{cat.icone||'🍽️'}</span>
                <span className="cat-drop-name">{cat.nome}</span>
                <span className="cat-drop-arrow">›</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StoreApp({ onAdmin }) {
  const [page,          setPage]         = useState('home');
  const [selCat,        setSelCat]        = useState(null);
  const [search,        setSearch]        = useState('');
  const [modal,         setModal]         = useState(null);
  const [cartOpen,      setCartOpen]      = useState(false);
  const [waMsg,         setWaMsg]         = useState('');
  /* Estado visual do header — não afeta lógica */
  const [deliveryMode,   setDeliveryMode]   = useState('entrega');
  const [deliveryAddress,setDeliveryAddress] = useState(()=>
    localStorage.getItem(STORAGE_KEYS.DELIVERY_ADDRESS)||'');
  const [showAddressModal,setShowAddressModal] = useState(false);
  const [showLoyalty,    setShowLoyalty]     = useState(false);
  /* ── Programa de Fidelidade ── armazenado localmente */
  const [loyaltyCount,   setLoyaltyCount]    = useState(()=>
    parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_COUNT)||'0'));
  const [loyaltyConfig]  = useState(()=>({
    required: parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_REQUIRED)||'10'),
    discount: parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_DISCOUNT)||'50'),
  }));
  const loyaltyReward = loyaltyCount >= loyaltyConfig.required;
  const [storeOpen,      setStoreOpen]       = useState(()=>{
    /* Ler do localStorage — Admin pode alterar */
    const saved = localStorage.getItem(STORAGE_KEYS.STORE_STATUS);
    if (saved) return saved === 'open';
    /* Fallback: horário automático 09h–22h */
    const h = new Date().getHours();
    return h >= 9 && h < 22;
  });
  const cart = useCart();
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
                {storeOpen ? 'Aberto agora' : 'Fechado agora'}
              </div>
              {!storeOpen && (
                <button className="btn-agendar" onClick={()=>alert('Agendamento em breve!')}>
                  📅 Agendar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Direita: carrinho + admin (admin só para logados) */}
        <div className="header-actions">
          <button className="header-cart-btn" onClick={()=>setCartOpen(true)}>
            🛒{cart.count>0&&<span> {fmt(cart.total)}</span>}
            {cart.count>0&&<span className="cart-badge">{cart.count}</span>}
          </button>
          <button className="header-admin-btn" onClick={onAdmin} title="Painel Admin">
            ⚙️
          </button>
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

      {/* ── Progresso de fidelidade mini (abaixo da barra de entrega) ── */}
      {loyaltyCount>0 && !loyaltyReward && (
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
      {loyaltyReward && (
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
            setDeliveryAddress(addr);
            localStorage.setItem(STORAGE_KEYS.DELIVERY_ADDRESS, addr);
            if (meta && meta.lat) {
              localStorage.setItem(STORAGE_KEYS.DELIVERY_META, JSON.stringify(meta));
            }
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
                    onClick={()=>{
                      /* Zerar: order_count=0, reward_available=false, reward_used=true */
                      setLoyaltyCount(0);
                      localStorage.setItem(STORAGE_KEYS.LOYALTY_COUNT,'0');
                      localStorage.setItem(STORAGE_KEYS.LOYALTY_REWARD_USED,'true');
                      setShowLoyalty(false);
                    }}
                    style={{
                      padding:'13px 32px',borderRadius:12,border:'none',
                      background:'linear-gradient(135deg,#16A34A,#15803D)',
                      color:'#fff',fontWeight:700,fontSize:15,cursor:'pointer',
                      fontFamily:'var(--font-body)',boxShadow:'0 4px 16px rgba(22,163,74,.3)',
                    }}>
                    ✅ Usar desconto agora
                  </button>
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

/* ── Root ────────────────────────────────────────────────────── */
function App() {
  const [mode, setMode] = useState(()=>{
    /* Acesso por hash #admin-encanto */
    if (typeof window !== 'undefined' && window.location.hash === '#admin-encanto') {
      window.history.replaceState(null,'',window.location.pathname);
      return 'login';
    }
    return 'store';
  });
  const [, setAdmin] = useState(null);

  let content;
  if (mode==='login')      content = <AdminLogin onLogin={u=>{setAdmin(u);setMode('admin');}}/>;
  else if (mode==='admin') content = <AdminPanel onExit={()=>{setMode('store');setAdmin(null);}}/>;
  else                     content = <StoreApp onAdmin={()=>setMode('login')}/>;

  /* AppShell envolve TUDO: BackgroundLayer (fundo único, loja + admin) + camada de conteúdo. */
  return (
    <AppShell>
      {content}
    </AppShell>
  );
}

export default App;
