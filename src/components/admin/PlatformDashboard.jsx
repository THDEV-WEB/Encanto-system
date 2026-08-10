/* components/admin/PlatformDashboard.jsx — REF-SAAS-02 · Onda 1 (Fase 7).
   Visao inicial do Platform Console: metricas REAIS, derivadas de platform_list_tenants() (nenhum
   numero fixo/inventado). "Operacional" = loja ativa E com pelo menos 1 administrador vinculado (sem
   isso, ninguem consegue logar e operar -- nao e' "pronta" so por existir, mesma logica da Onda 8.2). */
import { useEffect, useState } from 'react';
import { DS } from '../../services/DataService.js';

function Card({ label, valor, tom, testId }) {
  const cores = {
    neutro: { fg: 'var(--gray-900)', bg: 'var(--gray-100)' },
    ok:     { fg: '#15803D', bg: '#F0FDF4' },
    alerta: { fg: '#B91C1C', bg: '#FEF2F2' },
  };
  const c = cores[tom] || cores.neutro;
  return (
    <div className="admin-card" style={{ padding: 18, textAlign: 'center' }} data-testid={testId}>
      <div style={{ fontSize: 30, fontWeight: 800, color: c.fg }}>{valor}</div>
      <div style={{ fontSize: 12.5, color: 'var(--gray-500)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

export function PlatformDashboard({ onIrParaLojas }) {
  const [tenants, setTenants] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    DS.platformListTenants()
      .then((r) => { if (vivo) setTenants(r); })
      .catch((e) => { if (vivo) setErro(e?.message || 'Nao foi possivel carregar.'); });
    return () => { vivo = false; };
  }, []);

  if (erro) return <p style={{ fontSize: 13, color: 'var(--red)' }}>{erro}</p>;
  if (!tenants) return <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Carregando…</p>;

  const totalLojas = tenants.length;
  const operacionais = tenants.filter(t => t.status === 'ativo' && t.admin_count > 0).length;
  const emConfiguracao = tenants.filter(t => t.status === 'ativo' && t.admin_count === 0).length;
  const suspensas = tenants.filter(t => t.status === 'suspenso').length;
  const totalAdmins = tenants.reduce((soma, t) => soma + t.admin_count, 0);
  const pendencias = emConfiguracao; // hoje a unica pendencia rastreada e' "aguardando administrador"

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 24 }}>
        <Card label="Lojas na plataforma" valor={totalLojas} tom="neutro" testId="platform-dashboard-total-lojas" />
        <Card label="Operacionais" valor={operacionais} tom="ok" testId="platform-dashboard-operacionais" />
        <Card label="Em configuração" valor={emConfiguracao} tom="alerta" testId="platform-dashboard-em-config" />
        <Card label="Suspensas" valor={suspensas} tom="alerta" testId="platform-dashboard-suspensas" />
        <Card label="Administradores" valor={totalAdmins} tom="neutro" testId="platform-dashboard-admins" />
      </div>

      {pendencias > 0 && (
        <div className="admin-card" style={{ padding: 16, marginBottom: 20, borderLeft: '4px solid #B91C1C' }} data-testid="platform-dashboard-pendencias">
          <strong style={{ fontSize: 13.5 }}>⚠️ {pendencias} loja{pendencias > 1 ? 's' : ''} aguardando administrador</strong>
          <p style={{ fontSize: 12.5, color: 'var(--gray-500)', marginTop: 4 }}>
            Criada{pendencias > 1 ? 's' : ''}, mas ainda sem ninguém que consiga logar e operar. Vá em "Lojas" para vincular um administrador.
          </p>
        </div>
      )}

      <button className="btn-primary" onClick={onIrParaLojas} data-testid="platform-dashboard-ir-lojas">
        🏪 Ver todas as lojas
      </button>
    </div>
  );
}
