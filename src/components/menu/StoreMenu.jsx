/* components/menu/StoreMenu.jsx — botão ☰ do header + orquestração do drawer e telas (LOGIN-ARCH-02).
   Auto-contido: StoreApp só renderiza <StoreMenu/> no header (App.jsx intocado). O botão reusa a
   classe do header (mesmo padding/tamanho/raio/hover que carrinho e engrenagem). */
import { useState } from 'react';
import { SideDrawer } from './SideDrawer.jsx';
import { LoginScreen } from './LoginScreen.jsx';
import { ContatoScreen } from './ContatoScreen.jsx';
import { SobreScreen } from './SobreScreen.jsx';
import { TermosScreen } from './TermosScreen.jsx';
import { FidelidadeScreen } from './FidelidadeScreen.jsx';
import { CompletarCadastro } from './CompletarCadastro.jsx';
import { MeusPedidosScreen } from '../pedidos/MeusPedidosScreen.jsx';

export function StoreMenu() {
  const [drawer, setDrawer] = useState(false);
  const [tela, setTela] = useState(null); // login | pedidos | contato | sobre | termos | fidelidade
  const navegar = (t) => { setDrawer(false); setTela(t); };
  const fechar = () => setTela(null);

  return (
    <>
      <button className="header-admin-btn" onClick={() => setDrawer(true)} title="Menu" aria-label="Menu"
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      {drawer && <SideDrawer onClose={() => setDrawer(false)} onNavigate={navegar} />}
      {tela === 'login' && <LoginScreen onClose={fechar} />}
      {tela === 'pedidos' && <MeusPedidosScreen onClose={fechar} />}
      {tela === 'contato' && <ContatoScreen onClose={fechar} />}
      {tela === 'sobre' && <SobreScreen onClose={fechar} />}
      {tela === 'termos' && <TermosScreen onClose={fechar} />}
      {tela === 'fidelidade' && <FidelidadeScreen onClose={fechar} />}
      {/* 1o acesso: pede telefone (identidade) apos login por Google/e-mail. Auto-oculta. */}
      <CompletarCadastro />
    </>
  );
}
