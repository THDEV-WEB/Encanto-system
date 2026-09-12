/* components/admin/AdminFaturamento.jsx — REF-BILLING-01 · Onda 4.
   Aba "Faturamento" do Admin da PRÓPRIA loja: consulta SOMENTE-LEITURA (status/vencimento/histórico) --
   nunca marca mensalidade paga, nunca configura vencimento/contato financeiro, essas 3 ações
   continuam EXCLUSIVAS do Platform Admin (aba Faturamento do Platform Console, Onda 3). Reaproveita o
   billingStatus já carregado por AdminStoreProvider (mesmo get_billing_status da Onda 1/3, sem chamada
   de rede própria aqui) -- inclui 'historico' desde a Onda 3, extensão aditiva. */
import { useAdminStore } from '../../hooks/useAdminStore.js';
import { fmt, fmtDataCalendario, fmtDataHoraLoja } from '../../utils/format.js';

const CORES_STATUS = {
  em_dia:         { fg: '#15803D', bg: '#F0FDF4', ponto: '🟢', texto: 'Em dia' },
  carencia:       { fg: '#B91C1C', bg: '#FEF2F2', ponto: '🔴', texto: 'Em atraso (carência)' },
  bloqueada:      { fg: '#B91C1C', bg: '#FEF2F2', ponto: '🔴', texto: 'Bloqueada' },
  isenta:         { fg: '#1D4ED8', bg: '#EFF6FF', ponto: '🔵', texto: 'Isenta' },
  sem_assinatura: { fg: '#6B7280', bg: '#F3F4F6', ponto: '⚪', texto: 'Sem assinatura ativa' },
};

const ROTULOS_EVENTO = {
  mensalidade_gerada: 'Mensalidade gerada',
  vencimento: 'Vencimento atingido',
  pagamento_confirmado: 'Pagamento confirmado',
  alteracao_vencimento: 'Dia de vencimento alterado',
  entrada_carencia: 'Entrou em carência',
  bloqueio: 'Bloqueado',
  isencao: 'Marcado como isento',
};

export function AdminFaturamento() {
  const { billingStatus } = useAdminStore();

  if (!billingStatus) return <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Carregando…</p>;

  const status = CORES_STATUS[billingStatus.status] || CORES_STATUS.sem_assinatura;
  const historico = billingStatus.historico || [];

  return (
    <div>
      <div className="admin-card" style={{ marginBottom: 20 }}>
        <div className="admin-card-header"><h3>💳 Situação da assinatura</h3></div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13.5, color: 'var(--gray-600)', lineHeight: 2 }}>
            Status: <span style={{ fontWeight: 700, color: status.fg, background: status.bg, padding: '2px 10px', borderRadius: 20 }}>{status.ponto} {status.texto}</span><br/>
            {billingStatus.valor_devido != null && <>Mensalidade: {fmt(billingStatus.valor_devido)}<br/></>}
            {billingStatus.proximo_vencimento && <>Próximo vencimento: {fmtDataCalendario(billingStatus.proximo_vencimento)}<br/></>}
            {billingStatus.trial_ate && <>Trial até: {fmtDataCalendario(billingStatus.trial_ate)}<br/></>}
          </p>
          <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>
            Consulta somente leitura -- configuração de vencimento, contato financeiro e confirmação de
            pagamento são feitas exclusivamente pela VALION.
          </p>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-header"><h3>🧾 Histórico</h3></div>
        <div style={{ padding: 20 }}>
          {historico.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--gray-400)' }}>Nenhum evento registrado ainda.</p>
          ) : historico.map((ev, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: i < historico.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{ROTULOS_EVENTO[ev.tipo] || ev.tipo}</div>
              <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{fmtDataHoraLoja(ev.created_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
