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

/* ── FLUXO OPERACIONAL (REF-ORDER-01 · integracao + REF-MESA-01 · Onda 5) ────────────────────────
   Trilha por TIPO: retirada e mesa NAO tem "Saiu para entrega" (nao ha entregador) -> concluem de
   'pronto' direto em 'entregue'. Mesa reusa os MESMOS 4 valores de status de retirada (orders.status
   so aceita 'recebido'/'preparo'/'pronto'/'entrega'/'entregue'/'cancelado' via CHECK constraint —
   introduzir um valor novo tipo 'servido' exigiria migration de schema, fora do escopo desta onda;
   "Entregue" permanece honesto o suficiente pra mesa: o pedido foi concluido/entregue na propria
   mesa). Puro/sem imports (folha). Usado pelos botoes de avancar status no admin.
   fluxoDoTipo deixa de ser ternario de 2 vias -- terceiro tipo nunca mais herda a trilha de entrega
   por default (a fragilidade exata que motivou a REF-MESA-01). */
export const FLUXO_ENTREGA  = ['recebido', 'preparo', 'pronto', 'entrega', 'entregue'];
export const FLUXO_RETIRADA = ['recebido', 'preparo', 'pronto', 'entregue'];
export const FLUXO_MESA     = ['recebido', 'preparo', 'pronto', 'entregue'];
export const fluxoDoTipo = (tipo) => {
  if (tipo === 'retirada') return FLUXO_RETIRADA;
  if (tipo === 'mesa') return FLUXO_MESA;
  return FLUXO_ENTREGA;
};

/* Proximo status na trilha do tipo (ou null no fim / status fora da trilha, ex.: 'cancelado'). */
export const proximoStatus = (status, tipo) => {
  const f = fluxoDoTipo(tipo);
  const i = f.indexOf(status);
  return i >= 0 && i < f.length - 1 ? f[i + 1] : null;
};
