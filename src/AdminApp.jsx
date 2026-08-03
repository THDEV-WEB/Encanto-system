import { useCallback } from 'react';
import AppShell from './AppShell.jsx';
import './index.css';
import { AdminLogin } from './components/admin/AdminLogin.jsx';
import { AdminPanel } from './components/admin/AdminPanel.jsx';
import { useAdminSession } from './hooks/useAdminSession.js'; // REF-ADMIN-01/REF-STABILITY-02: sessao do admin, 100% reaproveitado
import { usePwaUpdate } from './hooks/usePwaUpdate.js'; // REF-MOBILE-01 Onda 6: mesmo aviso de "nova versao", agora tambem no bundle do admin
import { Toast } from './components/ui/Toast.jsx';

/* REF-ADMIN-04: "Ver loja" deixa de ser troca de `mode` no MESMO bundle (nao existe StoreApp aqui) e
   passa a ser navegacao real pro dominio da loja. Unica adaptacao de comportamento desta REF — o resto
   do fluxo (login, is_admin(), sessao, logout) e' o MESMO codigo de sempre. */
const STORE_URL = 'https://encanto.valionsistemas.com.br/encanto/';

/* Raiz do bundle administrativo (admin.html/admin-main.jsx) — sem StoreApp, sem AuthProvider do
   cliente, sem mode-switch nenhum. REF-ADMIN-04 · Onda 4: useAdminSession() simplificado (só
   'login'/'admin', sem estado 'store'/hash) — este bundle é o único consumidor do hook desde que o
   acesso pela loja foi removido. */
function AdminApp() {
  const { mode, admin, entrar, sair } = useAdminSession();
  const { novaVersaoDisponivel, atualizar, dispensar } = usePwaUpdate();
  const irParaLoja = useCallback(() => { window.location.href = STORE_URL; }, []);

  const content = mode === 'admin'
    ? <AdminPanel admin={admin} onExit={irParaLoja} onLogout={sair} />
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
