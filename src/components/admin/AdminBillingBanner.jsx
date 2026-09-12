/* components/admin/AdminBillingBanner.jsx — REF-BILLING-01 · Onda 4.
   Aviso DISCRETO de vencimento/carência, visível em toda aba do Admin da loja (montado uma vez em
   AdminPanel.jsx, acima de .admin-body -- nunca desmonta ao trocar de aba, só ao trocar de loja).
   Transparência ANTES do bloqueio (seção E do doc de descoberta) -- nunca é o bloqueio em si (isso é
   AdminBillingBloqueado.jsx, tela cheia, só quando status==='bloqueada'). billingStatus vem pronto de
   AdminStoreProvider (mesmo get_billing_status já usado pelo Platform Console, Onda 3) -- nenhuma
   chamada de rede própria aqui.

   Limiar de "vencimento próximo" (3 dias) é decisão de IMPLEMENTAÇÃO, não de negócio -- o doc só fecha
   os 5 dias de carência (B.8) e os 3 canais de aviso (B.12/visual+e-mail+WhatsApp), não um número de
   dias de antecedência pro aviso visual. Cálculo é so calendário (client-side, cosmético) -- quem
   decide de verdade carência/bloqueio é sempre o cron no servidor (Onda 2), nunca esta tela. */
import { useAdminStore } from '../../hooks/useAdminStore.js';
import { fmtDataCalendario } from '../../utils/format.js';

const DIAS_AVISO_ANTECEDENCIA = 3;

function diasAte(dataISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataISO || ''));
  if (!m) return null;
  const alvo = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const agora = new Date();
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  return Math.round((alvo - hoje) / 86400000);
}

export function AdminBillingBanner() {
  const { billingStatus } = useAdminStore();
  if (!billingStatus) return null; // desconhecido/carregando -- nunca mostra aviso errado

  const { status, proximo_vencimento } = billingStatus;

  if (status === 'carencia') {
    return (
      <div data-testid="admin-billing-banner-carencia" className="admin-card" style={{ marginBottom: 16, border: '1.5px solid #FCA5A5', background: '#FEF2F2' }}>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#B91C1C' }}>
            🔴 Mensalidade em atraso — vencida em {fmtDataCalendario(proximo_vencimento)}
          </div>
          <div style={{ fontSize: 12.5, color: '#991B1B', marginTop: 2 }}>
            Regularize o quanto antes para evitar o bloqueio do painel. Entre em contato com a VALION.
          </div>
        </div>
      </div>
    );
  }

  if (status === 'em_dia') {
    const dias = diasAte(proximo_vencimento);
    if (dias != null && dias >= 0 && dias <= DIAS_AVISO_ANTECEDENCIA) {
      return (
        <div data-testid="admin-billing-banner-proximo" className="admin-card" style={{ marginBottom: 16, border: '1.5px solid #FDE68A', background: '#FFFBEB' }}>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#92400E' }}>
              📅 Mensalidade vence {dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`} ({fmtDataCalendario(proximo_vencimento)})
            </div>
          </div>
        </div>
      );
    }
  }

  return null;
}
