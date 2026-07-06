/* hooks/useCart.js — REF-APP-01 · Onda 3 (move puro do App.jsx).
   Carrinho persistente (localStorage, wrapper {v,ts,items}, TTL 12h, sanitização defensiva) +
   derivados count/total (total via totalCarrinho do domínio pricing) e ações add/remove/updateQty/clear.
   Consumidor de domínio (utils/pricing) → listado na allowlist D1 do test:deps. */
import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage.js';
import { totalCarrinho } from '../utils/pricing.js';

export function useCart() {
  /* HARDEN-07: carrinho persistente em localStorage (sobrevive a refresh → destrava idempotência durável).
     Wrapper {v,ts,items}: TTL 12h (evita preço/estado obsoleto), versão (descarta shape antigo) e
     sanitização (filtra itens válidos, coage qty) — defensivo contra storage adulterado/legado. */
  const [items, setItems] = useState(()=>{
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.CART)||'null');
      if (!raw || raw.v!==1 || !Array.isArray(raw.items)) return [];
      if (Date.now() - (raw.ts||0) > 12*60*60*1000) return [];
      return raw.items.filter(i=>i&&typeof i==='object'&&i._key&&Number(i.qty)>=1).map(i=>({...i, qty:Number(i.qty)}));
    } catch (e) { return []; }
  });
  useEffect(()=>{ try { localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify({v:1, ts:Date.now(), items})); } catch (e) {} }, [items]);
  const count = items.reduce((a,i)=>a+i.qty, 0);
  const total = totalCarrinho(items);
  const add = (prod, qty, adicionais, obs)=>{
    console.log('[ENCANTO] cart.add chamado. prod.id=', prod?.id, 'tipo:', typeof prod?.id, 'qty=', qty);
    setItems(prev=>{
      const key = prod.id + JSON.stringify((adicionais||[]).map(a=>a.id).sort()) + '::' + (obs||'').slice(0,80);
      const idx = prev.findIndex(i=>i._key===key);
      if (idx>=0) { const n=[...prev]; n[idx]={...n[idx],qty:n[idx].qty+qty}; return n; }
      const novo = [...prev, {...prod, qty, adicionais:adicionais||[], obs:obs||'', _key:key}];
      console.log('[ENCANTO] Carrinho atualizado. Itens:', novo.length, novo);
      return novo;
    });
  };
  const remove    = key => setItems(p=>p.filter(i=>i._key!==key));
  const updateQty = (key,d) => setItems(p=>p.map(i=>i._key===key?{...i,qty:Math.max(1,i.qty+d)}:i));
  const clear     = () => setItems([]);
  return { items, count, total, add, remove, updateQty, clear };
}
