/* scripts/bench/pricing.bench.mjs — NORM-03.1
   Baseline de performance PERMANENTE do domínio financeiro. NÃO faz parte do
   caminho crítico da aplicação — serve só para flagrar regressões que degradem
   silenciosamente o pricing.js ao longo dos anos (clonagem profunda, JSON.parse/
   stringify, structuredClone, map/filter/reduce extra, spreads desnecessários…).
   Rodar: npm run bench:pricing   (ou: node scripts/bench/pricing.bench.mjs)

   NÃO é micro-otimização e NÃO altera implementação: apenas mede e registra.       */

import { performance } from 'node:perf_hooks';
import { precoUnitario, precoLinha, totalCarrinho } from '../../src/utils/pricing.js';

const N = 100_000;

/* Inputs representativos: um item com franquia grátis + premium pago; um carrinho misto. */
const item = { preco: 26.99, preco_promo: null, qty: 2, adicionais: [
  { preco: 0 }, { preco: 0 }, { preco: 0 }, { preco: 8.00 },
] };
const cart = [
  { preco: 29.90, preco_promo: 24.90, qty: 1, adicionais: [{ preco: 5.00 }] },
  { preco: 28.00, preco_promo: null,  qty: 2, adicionais: [] },
  { preco: 17.99, preco_promo: null,  qty: 3, adicionais: [{ preco: 6 }, { preco: 0 }] },
];

/* Mede `fn` por N iterações. `sink` impede dead-code elimination pelo JIT. */
function bench(fn) {
  for (let i = 0; i < 5_000; i++) fn();              // warmup (estabiliza o JIT)
  let sink = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) sink += fn();
  const ms = performance.now() - t0;
  if (Number.isNaN(sink)) throw new Error('sink NaN — benchmark não executou corretamente');
  return ms;
}

const r1 = bench(() => precoUnitario(item));
const r2 = bench(() => precoLinha(item));
const r3 = bench(() => totalCarrinho(cart));

const bloco = (label, ms) => `${label}:\n${N} execuções\nTempo: ${ms.toFixed(2)} ms`;
console.log('Benchmark Pricing\n');
console.log(bloco('precoUnitario', r1) + '\n');
console.log(bloco('precoLinha', r2) + '\n');
console.log(bloco('totalCarrinho', r3));
