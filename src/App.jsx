import { useRef } from 'react';
import AppShell from './AppShell.jsx';
import './index.css';
import { precoVitrine } from './utils/pricing.js'; /* eslint-disable-line no-unused-vars */ // TOKEN Regra F (deps.audit.mjs §F): App.jsx deve consumir pricing; consumidor real movido p/ components/admin/AdminProducts.jsx (Onda 6.4). NAO remover sem ajustar a Regra F.
import { resolverAdicionais } from './utils/addons.js'; /* eslint-disable-line no-unused-vars */ // TOKEN Regra F (deps.audit.mjs §F): App.jsx deve consumir addons; consumidores reais movidos p/ pages/StoreApp.jsx (Onda 9.1) e components/admin/AdminAdicionais.jsx (Onda 7.1). NAO remover sem ajustar a Regra F.
import { DS } from './services/DataService.js'; /* eslint-disable-line no-unused-vars */ // TOKEN guard test:ds-micro R2 (dataservice.micro.mjs §A): App.jsx mantem o residuo de consumo do DS (corpo movido p/ services/DataService.js na Onda 2). NAO remover sem ajustar o guard R2.
import { AdminLogin } from './components/admin/AdminLogin.jsx';
import { AdminPanel } from './components/admin/AdminPanel.jsx';
import { StoreApp } from './pages/StoreApp.jsx';
import { AuthProvider } from './providers/AuthProvider.jsx'; // AUTH-01: sessao do CLIENTE (envolve so a loja)
import { useAdminSession } from './hooks/useAdminSession.js'; // REF-ADMIN-01 · Onda 2: sessao do ADMIN (restauracao + logout real)
import { usePwaUpdate } from './hooks/usePwaUpdate.js'; // REF-MOBILE-01 Onda 6: Service Worker (aviso de nova versao, nunca troca sozinho)
import { useCapacitorBackButton } from './hooks/useCapacitorBackButton.js'; // REF-CAP-01 Onda 4: botao fisico "voltar" do Android
import { Toast } from './components/ui/Toast.jsx';

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
function App() {
  const { mode, admin, entrar, abrirLogin, verLoja, sair } = useAdminSession();
  const { novaVersaoDisponivel, atualizar, dispensar } = usePwaUpdate(); // REF-MOBILE-01 Onda 6
  const storeAppRef = useRef(null); // REF-CAP-01 Onda 4: resumo imperativo do que esta aberto na loja (ver StoreApp.jsx)
  useCapacitorBackButton({ mode, verLoja, storeRef: storeAppRef });

  let content;
  if (mode==='login')      content = <AdminLogin onLogin={entrar}/>;
  else if (mode==='admin') content = <AdminPanel admin={admin} onExit={verLoja} onLogout={sair}/>;
  /* AUTH-01: a loja (e SO ela) vive dentro do AuthProvider — sessao de cliente isolada do Admin.
     REF-STABILITY-02: todo bootstrap comeca aqui, sem excecao — a sessao do Admin persiste normalmente,
     mas nunca decide a tela inicial sozinha (so o clique em "Entrar" a reaproveita). */
  else                      content = <AuthProvider><StoreApp ref={storeAppRef} onAdmin={abrirLogin}/></AuthProvider>;

  /* AppShell envolve TUDO: BackgroundLayer (fundo único, loja + admin) + camada de conteúdo. */
  return (
    <AppShell>
      {content}
      {novaVersaoDisponivel && (
        <Toast tipo="sucesso" duracao={0} onClose={dispensar}>
          Nova versão disponível.{' '}
          <button onClick={atualizar} style={{ border: 'none', background: 'none', color: 'var(--grape)', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            Atualizar agora
          </button>
        </Toast>
      )}
    </AppShell>
  );
}

export default App;
