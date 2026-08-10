/* components/admin/PlatformConsole.jsx — REF-SAAS-02 · Onda 1 (Fases 5-7).
   Console PRÓPRIO da VALION SISTEMAS -- identidade e navegação separadas do Admin de qualquer loja
   (antes, Onda 8 da REF-SAAS-01, isto era uma aba "Plataforma" dentro do Admin da Encanto; essa mistura
   conceitual é exatamente o que esta onda corrige). Só monta para quem `is_super_admin()` -- o próprio
   AdminApp.jsx só decide mostrar isto quando isSuperAdmin (ver AdminAuthedShell) -- nunca condicionado a
   quantas lojas existem hoje.

   Layout reaproveita as MESMAS classes CSS do Admin (admin-layout/admin-sidebar/admin-card/btn-*) --
   instrução explícita da REF de não fazer um redesign geral. A separação é de CONTEÚDO/NAVEGAÇÃO/
   IDENTIDADE (🏛️ VALION SISTEMAS, nunca o logo/nome da loja), não de um novo sistema visual. */
import { useState } from 'react';
import { PlatformDashboard } from './PlatformDashboard.jsx';
import { PlatformTenants } from './PlatformTenants.jsx';

export function PlatformConsole({ onAbrirAdmin, onLogout }) {
  const [tab, setTab] = useState('dashboard');
  const tabs = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'lojas', icon: '🏪', label: 'Lojas' },
  ];
  const titles = { dashboard: 'Dashboard da Plataforma', lojas: 'Lojas' };

  return (
    <div className="admin-layout">
      <div className="admin-sidebar">
        <div className="admin-logo" data-testid="platform-console-titulo">🏛️ <span>VALION SISTEMAS</span></div>
        <div style={{ padding: '0 16px 12px', fontSize: 11, opacity: .65 }}>Platform Console</div>
        <nav className="admin-nav">
          {tabs.map((t) => (
            <div key={t.id} data-testid={`platform-tab-${t.id}`} className={`admin-nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </nav>
        <div style={{ padding: '16px 8px' }}>
          <div className="admin-nav-item" data-testid="platform-logout" onClick={onLogout} style={{ color: 'rgba(255,255,255,.5)' }}>
            <span className="nav-icon">🚪</span><span>Sair</span>
          </div>
        </div>
      </div>
      <div className="admin-content">
        <div className="admin-top">
          <h1>{titles[tab]}</h1>
        </div>
        <div className="admin-body">
          {tab === 'dashboard' && <PlatformDashboard onIrParaLojas={() => setTab('lojas')} />}
          {tab === 'lojas' && <PlatformTenants onAbrirAdmin={onAbrirAdmin} />}
        </div>
      </div>
    </div>
  );
}
