export const fmt = v => 'R$\u00a0' + Number(v||0).toFixed(2).replace('.',',');
export const fmtDate = d => d ? new Date(d).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '-';
/* REF-BOOT-01 Onda 2 — data/hora de eventos do PEDIDO no fuso da LOJA (America/Sao_Paulo).
   Correcao ISOLADA da tela de acompanhamento: orders/order_events.created_at sao `timestamp without time
   zone` gravados por now() sob sessao UTC -> guardam HORA UTC, mas chegam ao browser SEM offset e o
   `new Date()` os interpretava como hora LOCAL (mostrando +3h em aparelhos no fuso de Brasilia). Aqui:
   (1) string sem Z/offset -> tratada como UTC (anexa Z); (2) formata no fuso da loja. Compatibilidade
   universal: se o engine nao suportar timeZone IANA no Intl, cai no fallback UTC-3 fixo (SP sem DST desde
   2019). NAO altera fmtDate (usado por Admin/Minha Conta) — este formatador e usado so no acompanhamento. */
export const fmtDataHoraLoja = v => {
  if (!v) return '-';
  const s = typeof v === 'string' ? v : '';
  const semTz = s && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(semTz ? s.replace(' ', 'T') + 'Z' : v);
  if (isNaN(d.getTime())) return '-';
  try {
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  } catch {
    const sp = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${p(sp.getUTCDate())}/${p(sp.getUTCMonth() + 1)}/${sp.getUTCFullYear()}, ${p(sp.getUTCHours())}:${p(sp.getUTCMinutes())}`;
  }
};
/* Preço de partida — usado no card principal de produtos com múltiplos tamanhos
   (Monte seu Copo, Batidinhas e qualquer produto futuro que siga o mesmo padrão
   de `tamanhos`). Calcula o menor preço entre os tamanhos em vez de assumir que
   o campo `preco` top-level já está sincronizado, evitando duplicação de regra. */
// preço de um tamanho, tolerante a legado (preco | price)
export const precoTamanho = t => Number(t?.preco ?? t?.price) || 0;
export const precoApartir = prod => (Array.isArray(prod?.tamanhos) && prod.tamanhos.length>0)
  ? Math.min(...prod.tamanhos.map(precoTamanho))
  : Number(prod?.preco_promo || prod?.preco || 0);
export const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
