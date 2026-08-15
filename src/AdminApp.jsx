import { useCallback, useState } from 'react';
import AppShell from './AppShell.jsx';
import './index.css';
import { AdminLogin } from './components/admin/AdminLogin.jsx';
import { AdminPanel } from './components/admin/AdminPanel.jsx';
import { PlatformConsole } from './components/admin/PlatformConsole.jsx'; // REF-SAAS-02 · Onda 1: console proprio da VALION, separado do Admin da loja
import { AdminStoreProvider } from './providers/AdminStoreProvider.jsx'; // REF-SAAS-01 · Onda 5: loja ativa multi-loja
import { useAdminStore } from './hooks/useAdminStore.js';
import { useAdminSession } from './hooks/useAdminSession.js'; // REF-ADMIN-01/REF-STABILITY-02: sessao do admin, 100% reaproveitado
import { usePwaUpdate } from './hooks/usePwaUpdate.js'; // REF-MOBILE-01 Onda 6: mesmo aviso de "nova versao", agora tambem no bundle do admin
import { Toast } from './components/ui/Toast.jsx';

/* REF-ADMIN-04: "Ver loja" deixa de ser troca de `mode` no MESMO bundle (nao existe StoreApp aqui) e
   passa a ser navegacao real pro dominio da loja. Unica adaptacao de comportamento desta REF — o resto
   do fluxo (login, is_admin(), sessao, logout) e' o MESMO codigo de sempre.
   REF-ADMIN-04 · Onda 5: URL configuravel via VITE_STORE_URL (default = producao) — sem isso, o E2E
   (que serve loja+admin do MESMO dev server, sob /encanto/) navegaria pra producao de verdade ao clicar
   "Ver loja", violando o principio do projeto de nunca testar contra producao via automacao.
   REF-SAAS-02 · Onda 3: o "default = producao" deixou de ser um dominio FIXO (sempre Encanto, mesmo com
   outra loja ativa no seletor multi-loja da Onda 5 — bug real, achado ao ligar a Bar da Sogra: o botao
   levava o operador pro site de PRODUCAO REAL da Encanto, nunca da propria loja). Fora do E2E/dev
   (override abaixo), o destino agora vem do `dominio` da loja ATIVA (list_my_stores(), server-truth,
   Onda 3) — cada loja so' pode ir pro proprio site. Loja sem `dominio` ainda nao tem link pra oferecer —
   o botao fica desabilitado em vez de adivinhar/cair em outro tenant. */
const STORE_URL_OVERRIDE = import.meta.env.VITE_STORE_URL || null;

/* REF-SAAS-02 · Onda 1: super admin pousa no Platform Console (identidade/contexto VALION, separado
   visualmente de qualquer loja -- Fase 5/6 da REF) em vez de cair direto no Admin da Encanto com uma
   aba "Plataforma" embutida. "Abrir Admin da loja" troca a loja ativa (mesmo switchStore da Onda 5,
   contexto operacional -- quem autoriza de verdade continua sendo RLS/is_admin_of no servidor) e entra
   no AdminPanel normal daquela loja, com um link "<- Platform Console" pra voltar. Admin comum
   (isSuperAdmin=false) nunca ve nada disto -- cai direto no AdminPanel de sempre, zero mudanca. */
function AdminAuthedShell({ admin, onLogout }) {
  const { isSuperAdmin, switchStore, stores, activeStoreId } = useAdminStore();
  const [modoPlataforma, setModoPlataforma] = useState(isSuperAdmin);

  const abrirAdminDaLoja = useCallback((storeId) => {
    switchStore(storeId);
    setModoPlataforma(false);
  }, [switchStore]);

  if (modoPlataforma) {
    return <PlatformConsole onAbrirAdmin={abrirAdminDaLoja} onLogout={onLogout} />;
  }

  const dominioLojaAtiva = stores.find(s => s.store_id === activeStoreId)?.dominio || null;
  const lojaUrl = STORE_URL_OVERRIDE || (dominioLojaAtiva ? `https://${dominioLojaAtiva}/encanto/` : null);
  const onExit = lojaUrl ? () => { window.location.href = lojaUrl; } : undefined;

  return (
    <AdminPanel
      admin={admin}
      onExit={onExit}
      onLogout={onLogout}
      onVoltarPlataforma={isSuperAdmin ? () => setModoPlataforma(true) : undefined}
    />
  );
}

/* Raiz do bundle administrativo (admin.html/admin-main.jsx) — sem StoreApp, sem AuthProvider do
   cliente, sem mode-switch nenhum. REF-ADMIN-04 · Onda 4: useAdminSession() simplificado (só
   'login'/'admin', sem estado 'store'/hash) — este bundle é o único consumidor do hook desde que o
   acesso pela loja foi removido. */
function AdminApp() {
  const { mode, admin, entrar, sair } = useAdminSession();
  const { novaVersaoDisponivel, atualizar, dispensar } = usePwaUpdate();

  const content = mode === 'admin'
    ? <AdminStoreProvider><AdminAuthedShell admin={admin} onLogout={sair} /></AdminStoreProvider>
    : <AdminLogin onLogin={entrar} />;

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

export default AdminApp;
