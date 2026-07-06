/* tests/dataservice.micro.mjs — REF-APP-01 · Onda 2 · roda com: node tests/dataservice.micro.mjs
   MICRO-TESTS / GUARDS do DataService. Test-first, PRÉ-Onda 2 — transforma os riscos R2/R4/R5
   do ADR em asserções automatizadas ANTES de qualquer extração.

   ── ESTRATÉGIA (por que assim) ─────────────────────────────────────────────
   O objeto `DS` vive DENTRO de src/App.jsx (JSX, não importável em Node) e movê-lo é a Onda 2
   (proibida agora). Duas camadas, sem tocar produção:
     (A) GUARDS DE FONTE (verdes agora): materializam os "guards mecânicos" do ADR §5 —
         asserções sobre o texto de src/App.jsx que travam R2 (objeto literal / this, sem
         desestruturar DS), R4 (cache singleton único + invalidação nas escritas) e
         R5 (grava imagem_url, nunca image_url; _sanitizeImageUrl rejeita data:).
     (B) RUNTIME (test-first): tenta importar { DS } de src/services/DataService.js — que só
         nasce na Onda 2. Enquanto não existe, reporta PENDENTE (sem falhar). No 1º passo da
         extração, roda as asserções de runtime de _sanitizeImageUrl (R5) + _invalidateProductsCache
         (R4) + objeto/this (R2) — o gate que a extração deve manter verde.
   ADR: docs/adr/REF-APP-01-onda-2-plan.md (§1 anatomia, §5 matriz de risco, §6.4 micro-test). */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const dsStart = APP.indexOf('const DS = {');
const dsEnd   = APP.indexOf('/* ── Hooks', dsStart);
assert.ok(dsStart >= 0 && dsEnd > dsStart, 'não localizei o objeto DS em App.jsx');
const DSRC = APP.slice(dsStart, dsEnd);   // objeto DS { ... };
/* código do DS SEM comentários (a doc do _sanitizeImageUrl menciona "image_url" em prosa;
   o guard R5 deve olhar só CÓDIGO — o que é gravado/acessado — não comentários). */
const DSCODE = DSRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

console.error('— (A) GUARDS DE FONTE (ADR §5) sobre src/App.jsx');

/* R2 — objeto literal + this preservado (nunca desestruturar métodos) */
check('R2 DS é objeto literal (const DS = {)', () => assert.ok(/const DS = \{/.test(APP)));
check('R2 sem desestruturação de DS (const {…} = DS)', () => assert.ok(!/const\s*\{[^}]*\}\s*=\s*DS\b/.test(APP)));
check('R2 sem método solto (= DS.metodo; sem invocar)', () => assert.ok(!/=\s*DS\.\w+\s*;/.test(APP)));

/* R4 — cache singleton único + invalidação em toda escrita de produto */
check('R4 _globalProductsCache declarado 1× (singleton)', () => assert.strictEqual((APP.match(/_globalProductsCache:/g) || []).length, 1));
check('R4 _invalidateProductsCache zera cache+time', () => assert.ok(/_invalidateProductsCache\(\)\s*\{\s*this\._globalProductsCache\s*=\s*null;\s*this\._globalProductsCacheTime\s*=\s*0;\s*\}/.test(DSRC)));
check('R4 escritas invalidam cache (upsert/toggle/del ≥ 3 chamadas)', () => assert.ok((DSRC.match(/this\._invalidateProductsCache\(\)/g) || []).length >= 3));

/* R5 — imagem viva (imagem_url), nunca legada (image_url); base64 rejeitado */
check('R5 _sanitizeImageUrl rejeita data: (base64)', () => assert.ok(/url\.startsWith\('data:'\)\)\s*return null/.test(DSRC)));
check('R5 _sanitizeImageUrl exige http', () => assert.ok(/url\.startsWith\('http'\)\)\s*return null/.test(DSRC)));
check("R5 DS grava 'imagem_url' (viva)", () => assert.ok(/imagem_url/.test(DSCODE)));
check("R5 DS NÃO referencia 'image_url' (legada) no código", () => assert.ok(!/\bimage_url\b/.test(DSCODE)));

/* Anatomia — 22 métodos + 2 props (ADR §1): identidade do contrato preservada */
const MEMBROS = [
  '_globalProductsCache:', '_globalProductsCacheTime:', '_invalidateProductsCache()',
  'async run(', 'async fetchAllProductsSafe(', 'async getCats()', 'async getAllCats()',
  'async getProds(', 'async getAllProds()', 'async getAds()', 'async getAllAds()',
  'async savePedido(', 'async getPedidos()', 'async setStatus(', 'async getHealth()',
  'async logEvent(', 'async upsertCat(', 'async delCat(', '_sanitizeImageUrl(',
  'async upsertProd(', 'async toggleProd(', 'async delProd(', 'async upsertAd(', 'async delAd(',
];
check(`anatomia: ${MEMBROS.length} membros presentes (22 métodos + 2 props)`, () => {
  const faltando = MEMBROS.filter(s => !DSRC.includes(s));
  assert.deepStrictEqual(faltando, [], 'membros ausentes: ' + faltando.join(', '));
});
check('anatomia: savePedido → rpc create_order', () => assert.ok(/d\.rpc\('create_order'/.test(DSRC)));

/* ── (B) RUNTIME — test-first (verde na extração da Onda 2) ── */
console.error('— (B) RUNTIME do DS (ativa quando services/DataService.js existir)');
let mod = null;
try { mod = await import('../src/services/DataService.js'); } catch { /* módulo ainda não existe: pré-extração */ }
if (!mod?.DS) {
  console.error('  ⏳ PENDENTE: src/services/DataService.js ainda não existe (extração = Onda 2, não autorizada).');
  console.error('     Guards de fonte (A) já cobrem R2/R4/R5 no App.jsx; runtime ativa no 1º passo da extração.');
} else {
  const DS = mod.DS;
  check('rt R2 DS objeto literal com métodos', () => { assert.strictEqual(typeof DS, 'object'); assert.strictEqual(typeof DS.run, 'function'); assert.strictEqual(typeof DS.savePedido, 'function'); });
  check('rt R5 _sanitizeImageUrl(data:) → null', () => assert.strictEqual(DS._sanitizeImageUrl('data:image/png;base64,AAA'), null));
  check('rt R5 _sanitizeImageUrl("") → null',    () => assert.strictEqual(DS._sanitizeImageUrl(''), null));
  check('rt R5 _sanitizeImageUrl(null) → null',  () => assert.strictEqual(DS._sanitizeImageUrl(null), null));
  check('rt R5 _sanitizeImageUrl(ftp) → null',   () => assert.strictEqual(DS._sanitizeImageUrl('ftp://x/y'), null));
  check('rt R5 _sanitizeImageUrl(http) preserva', () => assert.strictEqual(DS._sanitizeImageUrl('http://x/y.png'), 'http://x/y.png'));
  check('rt R4 _invalidateProductsCache zera', () => {
    DS._globalProductsCache = [{ x: 1 }]; DS._globalProductsCacheTime = 123;
    DS._invalidateProductsCache();
    assert.strictEqual(DS._globalProductsCache, null);
    assert.strictEqual(DS._globalProductsCacheTime, 0);
  });
}

console.error(fail === 0
  ? '\n✅ dataservice.micro OK — guards R2/R4/R5 travados no App.jsx (runtime pronto p/ a extração)'
  : `\n❌ dataservice.micro — ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
