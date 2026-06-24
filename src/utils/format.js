export const fmt = v => 'R$\u00a0' + Number(v||0).toFixed(2).replace('.',',');
export const fmtDate = d => d ? new Date(d).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '-';
/* Preço de partida — usado no card principal de produtos com múltiplos tamanhos
   (Monte seu Copo, Batidinhas e qualquer produto futuro que siga o mesmo padrão
   de `tamanhos`). Calcula o menor preço entre os tamanhos em vez de assumir que
   o campo `preco` top-level já está sincronizado, evitando duplicação de regra. */
export const precoApartir = prod => (Array.isArray(prod?.tamanhos) && prod.tamanhos.length>0)
  ? Math.min(...prod.tamanhos.map(t=>Number(t.preco)||0))
  : Number(prod?.preco_promo || prod?.preco || 0);
export const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
