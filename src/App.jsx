import { useState } from 'react';
import AppShell from './AppShell.jsx';
import './index.css';
import { precoVitrine } from './utils/pricing.js'; /* eslint-disable-line no-unused-vars */ // TOKEN Regra F (deps.audit.mjs §F): App.jsx deve consumir pricing; consumidor real movido p/ components/admin/AdminProducts.jsx (Onda 6.4). NAO remover sem ajustar a Regra F.
import { resolverAdicionais } from './utils/addons.js'; /* eslint-disable-line no-unused-vars */ // TOKEN Regra F (deps.audit.mjs §F): App.jsx deve consumir addons; consumidores reais movidos p/ pages/StoreApp.jsx (Onda 9.1) e components/admin/AdminAdicionais.jsx (Onda 7.1). NAO remover sem ajustar a Regra F.
import { DS } from './services/DataService.js'; /* eslint-disable-line no-unused-vars */ // TOKEN guard test:ds-micro R2 (dataservice.micro.mjs §A): App.jsx mantem o residuo de consumo do DS (corpo movido p/ services/DataService.js na Onda 2). NAO remover sem ajustar o guard R2.
import { AdminLogin } from './components/admin/AdminLogin.jsx';
import { AdminPanel } from './components/admin/AdminPanel.jsx';
import { StoreApp } from './pages/StoreApp.jsx';
import { AuthProvider } from './providers/AuthProvider.jsx'; // AUTH-01: sessao do CLIENTE (envolve so a loja)

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
/* AdminFidelidade → src/components/admin/AdminFidelidade.jsx (REF-APP-01 · Onda 7.5) */
/* AdminHealth → src/components/admin/AdminHealth.jsx (REF-APP-01 · Onda 7.6) */
/* AdminPanel (barrel dos 8 sub-componentes admin) → src/components/admin/AdminPanel.jsx (REF-APP-01 · Onda 7.7) */

/* ── StoreApp ────────────────────────────────────────────────── */

/* ── LazySection: renderiza filhos apenas quando seção entra na tela ── */
/* LazySection -> src/components/ui/LazySection.jsx (REF-APP-01 Onda 4) */

/* AddressModal -> src/address/ (REF-ADDRESS-01: dominio proprio; ex-src/components/AddressModal.jsx da Onda 8.2) */

/* SearchBar -> src/components/SearchBar.jsx (REF-APP-01 Onda 8.1) */

/* StoreApp -> src/pages/StoreApp.jsx (REF-APP-01 Onda 9.1) */

/* ── Root ────────────────────────────────────────────────────── */
/* REF-BOOT-02 v2: checkpoint de RENDER-PHASE (dispara quando o React de fato renderiza App, ANTES do
   commit). Se CP-App-render aparece mas BOOT-140-committed nao, o render rodou e o commit nunca flushou. */
let _cpApp = false;
function App() {
  if (!_cpApp) { _cpApp = true; try { if (typeof window !== 'undefined' && window.__ENC_BOOT__ && window.__ENC_BOOT__.step) window.__ENC_BOOT__.step('CP-App-render', 'App() render-phase'); } catch { /* noop */ } }
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
  /* AUTH-01: a loja (e SO ela) vive dentro do AuthProvider — sessao de cliente isolada do Admin. */
  else                     content = <AuthProvider><StoreApp onAdmin={()=>setMode('login')}/></AuthProvider>;

  /* AppShell envolve TUDO: BackgroundLayer (fundo único, loja + admin) + camada de conteúdo. */
  return (
    <AppShell>
      {content}
    </AppShell>
  );
}

export default App;
