/* components/pedidos/pedidoStatus.js — mapeamento PURO do status do pedido (REF-CLIENTE-02).
   Fonte: orders.status (recebido/preparo/entrega/entregue/cancelado). Sem imports (folha de UI). */

export const STATUS_INFO = {
  recebido:  { label: 'Recebido',          cor: '#6B21A8', bg: '#F3E8FF', icon: '📥' },
  preparo:   { label: 'Em preparo',        cor: '#B45309', bg: '#FEF3C7', icon: '👨‍🍳' },
  pronto:    { label: 'Pronto',            cor: '#0F766E', bg: '#CCFBF1', icon: '🛎️' },   // REF-ORDER-01
  entrega:   { label: 'Saiu para entrega', cor: '#1D4ED8', bg: '#DBEAFE', icon: '🛵' },
  entregue:  { label: 'Entregue',          cor: '#15803D', bg: '#DCFCE7', icon: '✅' },
  cancelado: { label: 'Cancelado',         cor: '#B91C1C', bg: '#FEE2E2', icon: '✖️' },
};

export const statusInfo = (s) => STATUS_INFO[s] || { label: s || '—', cor: '#6B7280', bg: '#F3F4F6', icon: '•' };

/* Passos da timeline. REF-ORDER-01 inseriu 'pronto' entre preparo e entrega (Recebido -> Em preparo ->
   Pronto -> Saiu para entrega -> Entregue). 'cancelado' e tratado a parte (nao entra na trilha feliz).
   Retirada segue a mesma trilha e conclui em 'entregue' (o passo 'entrega' fica implicito p/ retirada). */
export const TIMELINE = ['recebido', 'preparo', 'pronto', 'entrega', 'entregue'];

/* ── FLUXO OPERACIONAL (REF-ORDER-01 · integracao) ──────────────────────────────────────────────
   Trilha por TIPO: retirada NAO tem "Saiu para entrega" (nao ha entregador) -> conclui de 'pronto'
   direto em 'entregue'. Puro/sem imports (folha). Usado pelos botoes de avancar status no admin. */
export const FLUXO_ENTREGA  = ['recebido', 'preparo', 'pronto', 'entrega', 'entregue'];
export const FLUXO_RETIRADA = ['recebido', 'preparo', 'pronto', 'entregue'];
export const fluxoDoTipo = (tipo) => (tipo === 'retirada' ? FLUXO_RETIRADA : FLUXO_ENTREGA);

/* Proximo status na trilha do tipo (ou null no fim / status fora da trilha, ex.: 'cancelado'). */
export const proximoStatus = (status, tipo) => {
  const f = fluxoDoTipo(tipo);
  const i = f.indexOf(status);
  return i >= 0 && i < f.length - 1 ? f[i + 1] : null;
};
