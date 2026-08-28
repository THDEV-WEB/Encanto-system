/* components/menu/StoreMenu.jsx — botão ☰ do header + orquestração do drawer e telas (LOGIN-ARCH-02).
   Auto-contido: StoreApp só renderiza <StoreMenu/> no header (App.jsx intocado). O botão reusa a
   classe do header (mesmo padding/tamanho/raio/hover que carrinho e engrenagem). */
import { useState, forwardRef, useImperativeHandle, lazy, Suspense } from 'react';
import { CompletarCadastro } from './CompletarCadastro.jsx'; // sempre ativo (auto-oculta) — nunca atras de `tela`, fica eager

/* REF-PERF-01: code splitting — nenhuma destas telas e necessaria pra 1a renderizacao da loja (so
   abrem se o cliente clicar no menu ☰). Cada uma vira um chunk proprio, baixado sob demanda. */
const SideDrawer         = lazy(() => import('./SideDrawer.jsx').then(m => ({ default: m.SideDrawer })));
const LoginScreen        = lazy(() => import('./LoginScreen.jsx').then(m => ({ default: m.LoginScreen })));
const ContatoScreen      = lazy(() => import('./ContatoScreen.jsx').then(m => ({ default: m.ContatoScreen })));
const SobreScreen        = lazy(() => import('./SobreScreen.jsx').then(m => ({ default: m.SobreScreen })));
const TermosScreen       = lazy(() => import('./TermosScreen.jsx').then(m => ({ default: m.TermosScreen })));
const PrivacidadeScreen  = lazy(() => import('./PrivacidadeScreen.jsx').then(m => ({ default: m.PrivacidadeScreen }))); // REF-LGPD-01
const FidelidadeScreen   = lazy(() => import('./FidelidadeScreen.jsx').then(m => ({ default: m.FidelidadeScreen })));
const MeusPedidosScreen  = lazy(() => import('../pedidos/MeusPedidosScreen.jsx').then(m => ({ default: m.MeusPedidosScreen })));
const MinhaContaScreen   = lazy(() => import('../conta/MinhaContaScreen.jsx').then(m => ({ default: m.MinhaContaScreen })));

// REF-CAP-01 · Onda 4: forwardRef + useImperativeHandle expõem SÓ um resumo imperativo do estado que já
// existia (drawer/tela) — nada é movido/renomeado. Único consumidor: o botão físico "voltar" do Android
// (hooks/useCapacitorBackButton.js), que precisa saber "tem algo aberto aqui?" sem StoreApp/App.jsx
// precisarem conhecer os detalhes do menu.
export const StoreMenu = forwardRef(function StoreMenu({ onRecomprar }, ref) {
  const [drawer, setDrawer] = useState(false);
  const [tela, setTela] = useState(null); // login | pedidos | conta | contato | sobre | termos | privacidade | fidelidade
  const navegar = (t) => { setDrawer(false); setTela(t); };
  const fechar = () => setTela(null);

  useImperativeHandle(ref, () => ({
    temAlgoAberto: () => drawer || !!tela,
    fecharTudo: () => { setDrawer(false); setTela(null); },
    // REF-LOYALTY-AUDIT-01: chip fidelidade (StoreApp.jsx) precisa abrir o MESMO fluxo de login do
    // drawer pra visitante nao-autenticado -- sem duplicar LoginScreen/Supabase Auth.
    abrirLogin: () => { setDrawer(false); setTela('login'); },
  }), [drawer, tela]);

  return (
    <>
      <button className="header-admin-btn" onClick={() => setDrawer(true)} title="Menu" aria-label="Menu"
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      <Suspense fallback={null}>
        {drawer && <SideDrawer onClose={() => setDrawer(false)} onNavigate={navegar} />}
        {tela === 'login' && <LoginScreen onClose={fechar} />}
        {tela === 'pedidos' && <MeusPedidosScreen onClose={fechar} onRecomprar={onRecomprar} />}
        {tela === 'conta' && <MinhaContaScreen onClose={fechar} />}
        {tela === 'contato' && <ContatoScreen onClose={fechar} />}
        {tela === 'sobre' && <SobreScreen onClose={fechar} />}
        {tela === 'termos' && <TermosScreen onClose={fechar} />}
        {tela === 'privacidade' && <PrivacidadeScreen onClose={fechar} />}
        {tela === 'fidelidade' && <FidelidadeScreen onClose={fechar} />}
      </Suspense>
      {/* 1o acesso: pede telefone (identidade) apos login por Google/e-mail. Auto-oculta. */}
      <CompletarCadastro />
    </>
  );
});
