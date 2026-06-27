/* tests/pricing.golden.mjs — NORM-03 · roda com:  node tests/pricing.golden.mjs
   Valida o CENTRO FINANCEIRO em 4 eixos + bordas:
   (A) EQUIVALÊNCIA   — nova impl === expressões inline antigas (verbatim)
   (B) VALOR ABSOLUTO — carrinhos com total calculado À MÃO e fixado
   (C) PUREZA         — não muta o input (structuredClone + deepStrictEqual)
   (D) IDEMPOTÊNCIA   — mesmo input ⇒ mesmo output
   + pins de borda da auditoria adversarial (coerção, NaN, NÃO-arredondamento).   */

import assert from 'node:assert/strict';
import { somaAdicionais, precoBaseItem, precoUnitario, precoLinha, totalCarrinho, emPromocao, precoVitrine } from '../src/utils/pricing.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

/* Referência: expressões inline ANTIGAS, copiadas verbatim de App.jsx */
const oldUnit  = i => Number(i.preco_promo||i.preco) + (i.adicionais||[]).reduce((s,ad)=>s+Number(ad.preco),0);
const oldLinha = i => oldUnit(i) * i.qty;
const oldTotal = items => items.reduce((a,i)=>{ const t=(i.adicionais||[]).reduce((s,ad)=>s+Number(ad.preco),0); return a+(Number(i.preco_promo||i.preco)+t)*i.qty; },0);
const oldPromo = p => p.preco_promo && Number(p.preco_promo) < Number(p.preco);
const oldVitr  = p => p.preco_promo || p.preco;

/* ── (A) EQUIVALÊNCIA ───────────────────────────────────────────────────── */
const itens = [
  {preco:17.99,preco_promo:null,qty:1,adicionais:[{preco:6}]},
  {preco:26.99,preco_promo:null,qty:2,adicionais:[{preco:0},{preco:0},{preco:2}]},
  {preco:18.00,preco_promo:null,qty:1,adicionais:[]},
  {preco:29.90,preco_promo:24.90,qty:3,adicionais:[{preco:5},{preco:4}]},
  {preco:0.1, preco_promo:null,qty:1,adicionais:[{preco:0.2}]},
  {preco:10,  preco_promo:0,   qty:1,adicionais:[]},
  {preco:10,  preco_promo:null,qty:1,adicionais:[{preco:null}]},
];
for (const i of itens) {
  check(`equiv unit ${i.preco}`,  ()=>assert.deepStrictEqual(precoUnitario(i), oldUnit(i)));
  check(`equiv linha ${i.preco}`, ()=>assert.deepStrictEqual(precoLinha(i),  oldLinha(i)));
}
for (const c of [[], itens, [itens[0]], [itens[3], itens[4]]])
  check('equiv total', ()=>assert.deepStrictEqual(totalCarrinho(c), oldTotal(c)));
for (const p of [{preco_promo:0,preco:17.99},{preco_promo:'',preco:17.99},{preco_promo:14.99,preco:17.99},{preco_promo:'0',preco:17.99},{preco_promo:null,preco:9.9}]) {
  check('equiv promo', ()=>assert.deepStrictEqual(emPromocao(p),  oldPromo(p)));
  check('equiv vitr',  ()=>assert.deepStrictEqual(precoVitrine(p), oldVitr(p)));
}

/* ── (B) VALOR ABSOLUTO (calculado à mão; valores EXATOS em IEEE-754) ───────
   Carrinhos com inteiros/meios de propósito → cálculo manual == máquina,
   logo strictEqual é seguro aqui. Cenários .99/.90 ficam em (B2).               */
const cartA = [{nome:'Marmita M', preco:18.00, preco_promo:null, qty:2, adicionais:[]}];
//             (18.00) × 2 = 36.00
const cartB = [{nome:'Combo', preco:25.00, preco_promo:20.00, qty:1, adicionais:[{preco:8.00},{preco:2.00}]}];
//             (20.00 + 8.00 + 2.00) × 1 = 30.00
const cartC = [
  {nome:'Açaí 500', preco:26.00, preco_promo:null, qty:1, adicionais:[{preco:0},{preco:0},{preco:2.00}]}, // 28.00
  {nome:'Batidinha',preco:18.00, preco_promo:null, qty:3, adicionais:[]},                                 // 54.00
  {nome:'Suco',     preco:8.00,  preco_promo:6.50, qty:2, adicionais:[]},                                 // 13.00
]; //                                                                                     Σ = 95.00
check('absoluto A = 36.00', ()=>assert.strictEqual(totalCarrinho(cartA), 36.00));
check('absoluto B = 30.00', ()=>assert.strictEqual(totalCarrinho(cartB), 30.00));
check('absoluto C = 95.00', ()=>assert.strictEqual(totalCarrinho(cartC), 95.00));

/* ── (B2) VALOR ABSOLUTO — cenários REAIS do domínio (exercita regras) ──────
   NOTA SOBRE A TOLERÂNCIA: ela decorre EXCLUSIVAMENTE da representação IEEE-754
   hoje usada para o dinheiro (preços .99/.90 não são exatos: cartD dá
   69.97999999999999 na máquina, ≠ 69.98 literal). Se o sistema migrar no futuro
   para CENTAVOS INTEIROS ou DECIMAL EXATO, estes testes DEVEM voltar a igualdade
   exata (strictEqual). A tolerância valida a REGRA DE NEGÓCIO sem fragilidade de
   ULP; o NÃO-arredondamento segue travado pela equivalência (.99) e pelos pins.   */
const assertClose = (label, got, esp) => check(`absoluto-real ${label}`, () => {
  // typeof === 'number' impede regressão por conversão silenciosa para string
  // (toFixed(), String(x), template-literal): tais regressões devolveriam string
  // e passariam despercebidas numa comparação numérica frouxa — aqui não passam.
  assert.strictEqual(typeof got, 'number', `retorno não-numérico: ${typeof got}`);
  assert.ok(Number.isFinite(got) && Math.abs(got - esp) < 1e-9, `got=${got} esp=${esp}`);
});

/* D — Açaí 500ml com franquia grátis + 1 premium pago, qty 2
   (26,99 base + 0+0+0 grátis + 8,00 Nutella) × 2 = 34,99 × 2 = 69,98  [máq: 69.97999999999999] */
const cartD = [{nome:'Açaí 500ml', preco:26.99, preco_promo:null, qty:2, adicionais:[
  {nome:'Banana',preco:0},{nome:'Granola',preco:0},{nome:'Paçoca',preco:0},{nome:'Nutella',preco:8.00},
]}];
assertClose('D Açaí grátis+premium ×2 = 69.98', totalCarrinho(cartD), 69.98);

/* E — carrinho MISTO com PROMOÇÃO + preço quebrado:
   Marmita+Açaí PROMO (24,90; era 29,90) + Carne Extra 5,00 → 29,90 ×1 = 29,90
   Batidinha Nutella 28,00 ×2 = 56,00 · Suco 8,00 ×1 = 8,00 · Σ = 93,90 */
const cartE = [
  {nome:'Marmita+Açaí', preco:29.90, preco_promo:24.90, qty:1, adicionais:[{nome:'Carne Extra',preco:5.00}]},
  {nome:'Batidinha Nutella', preco:28.00, preco_promo:null, qty:2, adicionais:[]},
  {nome:'Suco', preco:8.00, preco_promo:null, qty:1, adicionais:[]},
];
assertClose('E misto c/ promo = 93.90', totalCarrinho(cartE), 93.90);

/* ── (C) PUREZA — nenhuma função muta o input ──────────────────────────── */
const assertPuro = (label, fn, ...args) => {
  const snap = args.map(a => structuredClone(a));
  fn(...args);
  args.forEach((a,k)=>check(`puro ${label}`, ()=>assert.deepStrictEqual(a, snap[k])));
};
assertPuro('precoUnitario', precoUnitario, itens[1]);
assertPuro('precoLinha',    precoLinha,    itens[1]);
assertPuro('totalCarrinho', totalCarrinho, cartC);

/* ── (D) IDEMPOTÊNCIA — mesmo input ⇒ mesmo output ─────────────────────── */
const idem = (label, fn, ...args)=>check(`idem ${label}`, ()=>assert.deepStrictEqual(fn(...args), fn(...args)));
idem('precoUnitario', precoUnitario, itens[0]);
idem('precoLinha',    precoLinha,    itens[3]);
idem('totalCarrinho', totalCarrinho, cartC);

/* ── PINS DE BORDA (auditoria adversarial) ─────────────────────────────── */
const pin = (label, got, esp)=>check(`pin ${label}`, ()=>assert.ok(Object.is(got, esp), `new=${String(got)} esp=${String(esp)}`));
pin('NÃO-arredonda 0.1+0.2', somaAdicionais([{preco:0.1},{preco:0.2}]), 0.30000000000000004);
pin('Number(null)=0',        somaAdicionais([{preco:null}]), 0);
pin('soma null guard',       somaAdicionais(null), 0);
pin('base promo0→cheio',     precoBaseItem({preco_promo:0,preco:17.99}), 17.99);
pin('base NaN→cheio',        precoBaseItem({preco_promo:NaN,preco:17.99}), 17.99);
pin('base neg mantém',       precoBaseItem({preco_promo:-5,preco:17.99}), -5);
pin('linha qty string=30',   precoLinha({preco:10,qty:'3',adicionais:[]}), 30);
pin('linha sem qty=NaN',     precoLinha({preco:10,adicionais:[]}), NaN);
pin('promo retorna 0',       emPromocao({preco_promo:0,preco:17.99}), 0);
pin("promo retorna ''",      emPromocao({preco_promo:'',preco:17.99}), '');
pin('promo true',            emPromocao({preco_promo:14.99,preco:17.99}), true);
pin('vitr promo=9.9',        precoVitrine({preco_promo:9.9,preco:17.99}), 9.9);

console.log(fail===0 ? '✅ pricing.golden OK — equivalência + absoluto + real + pureza + idempotência + bordas' : `❌ ${fail} falha(s)`);
process.exit(fail===0 ? 0 : 1);
