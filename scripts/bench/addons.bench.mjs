/* scripts/bench/addons.bench.mjs — NORM-04 · roda com:  npm run bench:addons
   Baseline de performance PERMANENTE do domínio de adicionais. NÃO é caminho crítico —
   serve só para flagrar regressão de complexidade silenciosa (filter→map→filter→reduce→
   sort→O(n²), clone profundo, etc.). Mede e registra; NÃO otimiza, NÃO altera implementação.  */

import { performance } from 'node:perf_hooks';
import { MOCK_ADS, resolverAdicionais, agruparPorGrupo, resolverPrecoAdicionais, ehAdicionalGratis } from '../../src/utils/addons.js';

const N = 100_000;

/* Fonte realista: ~15 reais (c3) + os 20 do MOCK. */
const FONTE = [
  ...Array.from({length:6}, (_,i)=>({id:'s'+i,nome:'Simples'+i,grupo:'simples',tipo:'gratis',preco:2,aplica_categoria_id:'c3',ordem:i})),
  ...Array.from({length:9}, (_,i)=>({id:'x'+i,nome:'Prem'+i,grupo:'premium',tipo:'pago',preco:6,aplica_categoria_id:'c3',ordem:i})),
  ...MOCK_ADS,
];
const PROD = {categoria_id:'c3', grupos_ad:['simples','premium','frutas_premium','chocolates'], tamanhos:[{label:'300ml',adicionais_gratis:2}]};
const SEL  = [{id:'a',tipo:'gratis',preco:2},{id:'b',tipo:'gratis',preco:2},{id:'c',tipo:'pago',preco:8},{id:'d',tipo:'gratis',preco:2}];

/* Mede `fn` por N iterações. `sink` impede dead-code elimination pelo JIT. */
function bench(fn) {
  for (let i = 0; i < 5_000; i++) fn();              // warmup
  let sink = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { const r = fn(); sink += Array.isArray(r) ? r.length : Object.keys(r).length; }
  const ms = performance.now() - t0;
  if (!Number.isFinite(sink)) throw new Error('sink inválido — benchmark não executou');
  return ms;
}

const r1 = bench(() => resolverAdicionais(FONTE, PROD));
const r2 = bench(() => agruparPorGrupo(FONTE, PROD));
const r3 = bench(() => resolverPrecoAdicionais(SEL, 2, ehAdicionalGratis));

const bloco = (label, ms) => `${label}:\n${N} execuções\nTempo: ${ms.toFixed(2)} ms`;
const MOCK_N = MOCK_ADS.length, REAIS_N = FONTE.length - MOCK_N;
const pad = k => (k + ' ').padEnd(18, '.');
console.log('Benchmark Addons\n');
/* Cabeçalho reproduzível (NORM-04.1) — apenas documenta o ambiente; não altera a lógica. */
console.log(pad('Node') + ' ' + process.version);
console.log(pad('Platform') + ' ' + process.platform);
console.log(pad('Architecture') + ' ' + process.arch);
console.log(pad('Dataset') + ` ${REAIS_N} adicionais (sintéticos c3) + ${MOCK_N} MOCK_ADS = ${FONTE.length}`);
console.log(pad('Iterations') + ' ' + N);
console.log(pad('Warmup') + ' yes (5000)');
console.log(pad('Generated') + ' ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
console.log('');
console.log(bloco('resolverAdicionais', r1) + '\n');
console.log(bloco('agruparPorGrupo', r2) + '\n');
console.log(bloco('resolverPrecoAdicionais', r3));
