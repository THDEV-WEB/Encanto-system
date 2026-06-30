/* utils/ids.js — helpers puros de identificadores (REF-APP-01 · Onda 1, move puro do App.jsx).
   Folha pura: sem React, sem I/O, sem dependências. */

/* ids de produtos do banco são uuid; ids de mock ('pmc1','pb1') não são.
   order_items.product_id é uuid → enviar só quando for uuid, senão null. */
export const isUuid = v => typeof v==='string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* Idempotency key (estilo Stripe): UUID estável por tentativa de checkout, enviado à RPC
   create_order. Retries/duplo-clique reusam a MESMA key → o banco devolve o pedido existente. */
export const newRequestId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
};
