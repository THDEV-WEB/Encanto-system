/* tests/price-domain-01.smoke.mjs — validacao funcional do PRICE-DOMAIN-01 (unificacao de precos).
   Roda em node puro: node tests/price-domain-01.smoke.mjs  (npm run test:price-domain).
   Combina:
     (A) contrato RUNTIME do barramento de cache (productCacheBus, modulo real) + guards de fonte
         de que TODA escrita do DataService emite e que useProducts assina/limpa _prodCache;
     (B) guards de fonte do editor de tamanhos no Admin (edicao, ocultacao do preco, espelho min);
     (C) guard de fonte do memo do ProductCard (passa a comparar preco/tamanhos);
     (D) COERENCIA Admin<->Loja: o preco espelho (min tamanhos) == precoApartir (o que a loja exibe),
         provado sobre dados reais (format.js real). Prova que Admin e Loja passam a concordar. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onProductsChanged, emitProductsChanged } from '../src/services/productCacheBus.js';
import { precoApartir, precoTamanho } from '../src/utils/format.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x ' + m + ' - ' + (e?.message ?? e)); } };
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

const DS_SRC    = read('../src/services/DataService.js');
const HOOK_SRC  = read('../src/hooks/useProducts.js');
const CARD_SRC  = read('../src/components/ProductCard.jsx');
const ADMIN_SRC = read('../src/components/admin/AdminProducts.jsx');

console.error('— (A) CAUSA A: invalidacao de cache Admin -> loja');
check('A1 productCacheBus.emit dispara assinantes; cancelar para de disparar', () => {
  let fired = 0;
  const off = onProductsChanged(() => fired++);
  emitProductsChanged();
  assert.strictEqual(fired, 1);
  off(); emitProductsChanged();
  assert.strictEqual(fired, 1, 'apos cancelar nao deve mais disparar');
});
check('A2 end-to-end: emit limpa um _prodCache (exatamente como useProducts faz)', () => {
  const _prodCache = new Map();
  const off = onProductsChanged(() => _prodCache.clear());
  _prodCache.set('*::', [{ id: 1 }]);
  emitProductsChanged();
  assert.strictEqual(_prodCache.size, 0);
  off();
});
check('A3 DataService emite em TODA escrita (upsert/toggle/del >= 3 chamadas)', () =>
  assert.ok((DS_SRC.match(/emitProductsChanged\(\)/g) || []).length >= 3));
check('A4 useProducts assina onProductsChanged e limpa _prodCache', () =>
  assert.ok(/onProductsChanged\(\s*\(\)\s*=>\s*_prodCache\.clear\(\)\s*\)/.test(HOOK_SRC)));
check('A5 _invalidateProductsCache do DS intacto (guard R4 do ds-micro preservado)', () =>
  assert.ok(/_invalidateProductsCache\(\)\s*\{\s*this\._globalProductsCache\s*=\s*null;\s*this\._globalProductsCacheTime\s*=\s*0;\s*\}/.test(DS_SRC)));

console.error('— (C) CAUSA C: memo do ProductCard compara preco');
check('C1 memo compara preco/preco_promo/precoApartir', () => {
  assert.ok(/prev\.prod\.preco\s*===\s*next\.prod\.preco/.test(CARD_SRC));
  assert.ok(/prev\.prod\.preco_promo\s*===\s*next\.prod\.preco_promo/.test(CARD_SRC));
  assert.ok(/precoApartir\(prev\.prod\)\s*===\s*precoApartir\(next\.prod\)/.test(CARD_SRC));
});

console.error('— (B) CAUSA B: Admin edita tamanhos, oculta preco, espelha preco=min');
check('B1 Admin tem estado e handlers de edicao de tamanhos', () => {
  assert.ok(/tamanhos\s*:/.test(ADMIN_SRC));
  assert.ok(/addTamanho/.test(ADMIN_SRC) && /updTamanho/.test(ADMIN_SRC) && /delTamanho/.test(ADMIN_SRC));
});
check('B2 Admin oculta preco/preco_promo quando ha tamanhos', () =>
  assert.ok(/\{!temTamanhos\s*&&\s*\(/.test(ADMIN_SRC)));
check('B3 Admin ao salvar: tamanhos persistido, preco=min, preco_promo=null', () => {
  assert.ok(/data\.tamanhos\s*=\s*tamanhosNorm/.test(ADMIN_SRC));
  assert.ok(/data\.preco\s*=\s*Math\.min\(\s*\.\.\.\s*tamanhosNorm\.map\(t\s*=>\s*t\.preco\)\s*\)/.test(ADMIN_SRC));
  assert.ok(/data\.preco_promo\s*=\s*null/.test(ADMIN_SRC));
});

console.error('— (D) COERENCIA Admin<->Loja: preco espelho (min) == precoApartir (o que a loja exibe)');
const mirror = tamanhos => Math.min(...tamanhos.map(t => Number(t.preco)));
const AMOSTRAS = [
  { nome:'Monte seu Copo',        tamanhos:[{label:'300 ml',preco:17.99},{label:'500 ml',preco:26.99},{label:'700 ml',preco:35.99}] },
  { nome:'Batidinha Tradicional', tamanhos:[{label:'300 ml',preco:18},{label:'500 ml',preco:23}] },
  { nome:'Batidinha de Nutella',  tamanhos:[{label:'300 ml',preco:22},{label:'500 ml',preco:28}] },
];
for (const p of AMOSTRAS) {
  check(`D ${p.nome}: espelho(min)=${mirror(p.tamanhos)} == precoApartir`, () => {
    assert.strictEqual(mirror(p.tamanhos), precoApartir(p));
    assert.strictEqual(precoApartir(p), Math.min(...p.tamanhos.map(precoTamanho)));
  });
}
check('D simples: precoApartir usa preco_promo||preco (inalterado)', () => {
  assert.strictEqual(precoApartir({ preco: 19.9, preco_promo: null }), 19.9);
  assert.strictEqual(precoApartir({ preco: 19.9, preco_promo: 14.9 }), 14.9);
});

console.log(fail === 0
  ? '\nOK price-domain-01 — unificacao validada (A cache, B admin/tamanhos, C memo, D coerencia Admin<->Loja)'
  : `\nFALHA: ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
