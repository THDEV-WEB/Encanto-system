/* components/admin/AdminBillingBloqueado.jsx — REF-BILLING-01 · Onda 4.
   Mensagem clara no lugar do painel normal quando a assinatura da loja está 'bloqueada' -- seção E do
   doc de descoberta: "nunca uma tela de erro genérica/confusa". Renderizada por AdminPanel.jsx no
   lugar de .admin-body (mesma posição, sidebar/nav/Sair continuam intactos -- bloqueio nunca tranca o
   logout). NUNCA renderizada para o super admin (is_admin_of nunca bloqueia o Platform Admin, Onda 1 --
   a checagem de isSuperAdmin fica em AdminPanel.jsx, aqui é só a mensagem em si). */
export function AdminBillingBloqueado() {
  return (
    <div className="admin-card" data-testid="admin-billing-bloqueado" style={{ maxWidth: 560, margin: '40px auto', border: '1.5px solid #FCA5A5' }}>
      <div style={{ padding: '32px 28px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#B91C1C', marginBottom: 10 }}>Mensalidade pendente</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.7 }}>
          O acesso ao painel de gestão desta loja foi pausado por falta de pagamento da mensalidade da
          plataforma. Seus clientes continuam conseguindo pedir normalmente -- só a gestão fica
          indisponível até a regularização.
        </p>
        <p style={{ fontSize: 14, color: 'var(--gray-600)', marginTop: 12, fontWeight: 600 }}>
          Entre em contato com a VALION para regularizar e reativar o acesso.
        </p>
      </div>
    </div>
  );
}
