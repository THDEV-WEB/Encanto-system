/* tests/addons.golden.mjs — NORM-04 · roda com:  node tests/addons.golden.mjs
   Valida o DOMÍNIO DE ADICIONAIS em vários eixos:
   (A) SNAPSHOT por caso (11 discriminantes, fundamentados nos dados reais)
   (B) PUREZA via deepFreeze (mutação do input THROW na hora — não detecta depois, IMPEDE)
   (C) IDEMPOTÊNCIA + SUBCONJUNTO (saída ⊆ fonte; 2 chamadas = mesma lista/ordem)
   (D) FREEZE DE TAXONOMIA (todo grupo dos dados ∈ GRUPOS)
   (E) GUARD DE IMPORTS (addons.js não importa react/pricing/supabase/format/DataService)
   (F) PIN CRUZADO addons×pricing (resolverPrecoAdicionais alimenta somaAdicionais sem NaN)

   POLÍTICA: todo bug de produção corrigido no domínio gera um novo snapshot aqui.        */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRUPOS, MOCK_ADS, CAT_ADDON_GROUP,
  gruposDoProduto, selecionarFonteAdicionais, resolverAdicionais, agruparPorGrupo,
  ehAdicionalGratis, cotaGratis, resolverPrecoAdicionais, marmitaPermitido,
} from '../src/utils/addons.js';
import * as addonsNS from '../src/utils/addons.js';
import { somaAdicionais } from '../src/utils/pricing.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };
const ids = arr => arr.map(a => a.id);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.keys(o).forEach(k => deepFreeze(o[k])); Object.freeze(o); } return o; };

/* ── Fixtures fiéis aos DADOS REAIS (15 linhas c3, grupos simples/premium/frutas/choco) ── */
const DB_C3_15 = [
  {id:'s1',nome:'Banana',          grupo:'simples',       tipo:'gratis',preco:2.00,ativo:true,aplica_categoria_id:'c3',ordem:1},
  {id:'s2',nome:'Granola',         grupo:'simples',       tipo:'gratis',preco:2.00,ativo:true,aplica_categoria_id:'c3',ordem:2},
  {id:'s3',nome:'Paçoca',          grupo:'simples',       tipo:'gratis',preco:2.00,ativo:true,aplica_categoria_id:'c3',ordem:3},
  {id:'s4',nome:'Amendoim',        grupo:'simples',       tipo:'gratis',preco:2.00,ativo:true,aplica_categoria_id:'c3',ordem:4},
  {id:'s5',nome:'Leite Condensado',grupo:'simples',       tipo:'gratis',preco:2.00,ativo:true,aplica_categoria_id:'c3',ordem:5},
  {id:'s6',nome:'Leite em Pó',     grupo:'simples',       tipo:'gratis',preco:2.00,ativo:true,aplica_categoria_id:'c3',ordem:6},
  {id:'p1',nome:'Nutella',         grupo:'premium',       tipo:'pago',  preco:8.00,ativo:true,aplica_categoria_id:'c3',ordem:1},
  {id:'p2',nome:'Creme de Avelã',  grupo:'premium',       tipo:'pago',  preco:6.00,ativo:true,aplica_categoria_id:'c3',ordem:2},
  {id:'p3',nome:'Creme de Leitinho',grupo:'premium',      tipo:'pago',  preco:6.00,ativo:true,aplica_categoria_id:'c3',ordem:3},
  {id:'p4',nome:'Doce de Leite',   grupo:'premium',       tipo:'pago',  preco:5.00,ativo:true,aplica_categoria_id:'c3',ordem:4},
  {id:'f1',nome:'Morango',         grupo:'frutas_premium',tipo:'pago',  preco:6.00,ativo:true,aplica_categoria_id:'c3',ordem:1},
  {id:'f2',nome:'Kiwi',            grupo:'frutas_premium',tipo:'pago',  preco:6.00,ativo:true,aplica_categoria_id:'c3',ordem:2},
  {id:'f3',nome:'Uva Verde',       grupo:'frutas_premium',tipo:'pago',  preco:6.00,ativo:true,aplica_categoria_id:'c3',ordem:3},
  {id:'c1',nome:'Coloretti',       grupo:'chocolates',    tipo:'pago',  preco:4.00,ativo:true,aplica_categoria_id:'c3',ordem:1},
  {id:'c2',nome:'Ovomaltine',      grupo:'chocolates',    tipo:'pago',  preco:4.00,ativo:true,aplica_categoria_id:'c3',ordem:2},
];
const P1 = {categoria_id:'c3', grupos_ad:['simples','premium','frutas_premium','chocolates'], tamanhos:[{label:'300ml',preco:17.99,adicionais_gratis:2}], adicionais_gratis:0};

/* ── (A) SNAPSHOT por caso ───────────────────────────────────────────────── */
// 1. P1 c3-real flat → 15 ids na ORDEM da fonte (filtro não reordena)
check('1 P1 flat ordem-da-fonte', ()=>assert.deepStrictEqual(
  ids(resolverAdicionais(DB_C3_15, P1)),
  ['s1','s2','s3','s4','s5','s6','p1','p2','p3','p4','f1','f2','f3','c1','c2']));
// 2. P1 agrupado → 4 chaves na ordem de grupos_ad, cada grupo ordenado por `ordem`
check('2 P1 agrupado', ()=>{
  const g = agruparPorGrupo(resolverAdicionais(DB_C3_15, P1), P1);
  assert.deepStrictEqual(Object.keys(g), ['simples','premium','frutas_premium','chocolates']);
  assert.deepStrictEqual(ids(g.simples), ['s1','s2','s3','s4','s5','s6']);
  assert.deepStrictEqual(ids(g.premium), ['p1','p2','p3','p4']);
  assert.deepStrictEqual(ids(g.frutas_premium), ['f1','f2','f3']);
  assert.deepStrictEqual(ids(g.chocolates), ['c1','c2']);
});
// 3. P2 c1 grupos_ad=null → CAT_ADDON_GROUP['c1']=['acai','marmita'] sobre MOCK_ADS → 20 ids (dbAds c3 descartado pela fonte)
check('3 P2 c1 → MOCK 20', ()=>assert.deepStrictEqual(
  ids(resolverAdicionais(selecionarFonteAdicionais({categoria_id:'c1'}, DB_C3_15), {categoria_id:'c1', grupos_ad:null})),
  ['ag1','ag2','ag3','ag4','ag5','ag6','ap1','ap2','ap3','ap4','af1','af2','af3','ac1','ac2','amp1','amp2','amp3','amp4','amp5']));
// 4. P3 c9 grupos_ad=[] (vazio explícito) → [] (a borda sutil: ?? não pula [])
check('4 P3 c9 [] curto-circuita', ()=>assert.deepStrictEqual(resolverAdicionais(DB_C3_15, {categoria_id:'c9', grupos_ad:[]}), []));
check('4b gruposDoProduto respeita []', ()=>assert.deepStrictEqual(gruposDoProduto({categoria_id:'c9', grupos_ad:[]}), []));
// 5. P5 c5 marmita → marmitaPermitido DROPA Queijo/Bacon, mantém Carne
check('5 P5 marmita filtra', ()=>{
  const g = agruparPorGrupo([{id:'amp1',nome:'Carne Extra',grupo:'marmita'},{id:'qj',nome:'Queijo Extra',grupo:'marmita'},{id:'bc',nome:'Bacon',grupo:'marmita'}], {categoria_id:'c5', grupos_ad:null});
  assert.deepStrictEqual(Object.keys(g), ['marmita']);
  assert.deepStrictEqual(ids(g.marmita), ['amp1']);
});
// 6. P6 c3 SEM grupos_ad (mock) + MOCK como fonte → 15 'acai' (TRAVA o bug dual mock×real)
check('6 P6 dual mock', ()=>assert.deepStrictEqual(
  ids(resolverAdicionais(MOCK_ADS, {categoria_id:'c3'})),
  ['ag1','ag2','ag3','ag4','ag5','ag6','ap1','ap2','ap3','ap4','af1','af2','af3','ac1','ac2']));
// 7. P7 prod=null → []
check('7 P7 prod=null', ()=>assert.deepStrictEqual(resolverAdicionais(selecionarFonteAdicionais(null, DB_C3_15), null), []));
check('7b fonte prod=null', ()=>assert.deepStrictEqual(selecionarFonteAdicionais(null, DB_C3_15), []));
// 8. P8 ad sem grupo → cai em 'acai' (default herdado grupo||ACAI)
check('8 P8 ad sem grupo', ()=>{
  const g = agruparPorGrupo([{id:'x',nome:'Mystery',preco:3}], {categoria_id:'c4', grupos_ad:null});
  assert.deepStrictEqual(ids(g.acai), ['x']);
});
// 9. ehAdicionalGratis: TIPO vence preço (simples gratis preco 2.00 → true) E preço 0 (pago) → true
check('9a ehGratis tipo', ()=>assert.strictEqual(ehAdicionalGratis({tipo:'gratis',preco:2.00}), true));
check('9b ehGratis preco0', ()=>assert.strictEqual(ehAdicionalGratis({tipo:'pago',preco:0}), true));
check('9c ehGratis pago', ()=>assert.strictEqual(ehAdicionalGratis({tipo:'pago',preco:8}), false));
// 10. resolverPrecoAdicionais mix grátis+pago, cota=1 → [0, 8.00, 2.00]
check('10 resolverPreco mix', ()=>assert.deepStrictEqual(
  resolverPrecoAdicionais([{id:'a',tipo:'gratis',preco:2.00},{id:'b',tipo:'pago',preco:8.00},{id:'c',tipo:'gratis',preco:2.00}], 1, ehAdicionalGratis).map(a=>a.preco),
  [0, 8.00, 2.00]));
// 11. cotaGratis: tamanho 300ml → 2; sem tamanhos → prod.adicionais_gratis; sem nada → 0
check('11a cota por tamanho', ()=>assert.strictEqual(cotaGratis(P1, null), 2));
check('11b cota sem tamanhos', ()=>assert.strictEqual(cotaGratis({categoria_id:'c4', tamanhos:[], adicionais_gratis:1}, null), 1));
check('11c cota zero', ()=>assert.strictEqual(cotaGratis({categoria_id:'c4'}, null), 0));
// extra: selecionarFonteAdicionais (seam) — c3+null → [] (sem fallback p/ MOCK); ≠c3 → MOCK identidade
check('fonte c3+null=[]', ()=>assert.deepStrictEqual(selecionarFonteAdicionais({categoria_id:'c3'}, null), []));
check('fonte ≠c3 = MOCK', ()=>assert.strictEqual(selecionarFonteAdicionais({categoria_id:'c1'}, DB_C3_15), MOCK_ADS));

/* ── (B) PUREZA via deepFreeze (mutação THROW na hora) ───────────────────── */
check('B pureza resolverAdicionais (input congelado)', ()=>{ const f = deepFreeze(structuredClone(DB_C3_15)), p = deepFreeze(structuredClone(P1)); resolverAdicionais(f, p); });
check('B pureza agruparPorGrupo (input congelado)', ()=>{ const f = deepFreeze(structuredClone(DB_C3_15)), p = deepFreeze(structuredClone(P1)); agruparPorGrupo(f, p); });
check('B pureza resolverPrecoAdicionais (input congelado)', ()=>{ const s = deepFreeze([{id:'a',tipo:'gratis',preco:2},{id:'b',tipo:'pago',preco:8}]); resolverPrecoAdicionais(s, 1, ehAdicionalGratis); });

/* ── (C) IDEMPOTÊNCIA + SUBCONJUNTO ──────────────────────────────────────── */
check('C idempotência flat', ()=>assert.deepStrictEqual(resolverAdicionais(DB_C3_15, P1), resolverAdicionais(DB_C3_15, P1)));
check('C idempotência agrupado', ()=>assert.deepStrictEqual(agruparPorGrupo(DB_C3_15, P1), agruparPorGrupo(DB_C3_15, P1)));
check('C subconjunto (nenhum ad inventado)', ()=>{ const fonteIds = new Set(ids(DB_C3_15)); assert.ok(ids(resolverAdicionais(DB_C3_15, P1)).every(i => fonteIds.has(i))); });

/* ── (D) FREEZE DE TAXONOMIA ─────────────────────────────────────────────── */
check('D taxonomia: grupos reais ∈ GRUPOS', ()=>{
  const conhecidos = new Set(Object.values(GRUPOS));
  for (const ad of [...DB_C3_15, ...MOCK_ADS]) assert.ok(conhecidos.has(ad.grupo), `grupo órfão: ${ad.grupo}`);
});

/* ── (E) GUARD DE IMPORTS (mecânico) ─────────────────────────────────────── */
check('E addons.js não importa do app (react/pricing/supabase/format/DataService)', ()=>{
  const src = readFileSync(new URL('../src/utils/addons.js', import.meta.url), 'utf8');
  const importLines = src.split('\n').filter(l => /^\s*import\b/.test(l));   // só statements de import (não comentários)
  const proibido = /react|\.\/components|\.\.?\/pricing|pricing\.js|format\.js|supabase|DataService/i;
  assert.ok(!importLines.some(l => proibido.test(l)), `import proibido em addons.js: ${importLines.join(' | ')}`);
  assert.strictEqual(importLines.length, 0, `addons.js deve ser folha sem imports; achou: ${importLines.join(' | ')}`);
});

/* ── (E2) GUARD DE EXPORTAÇÕES — congela a API pública do domínio ────────── */
check('E2 API pública congelada (add/remove/rename de export exige revisão)', ()=>{
  const expected = ['ADICIONAL_SIMPLES_PRECO','GRUPOS','CAT_ADDON_GROUP','MOCK_ADS','marmitaPermitido','gruposDoProduto','selecionarFonteAdicionais','resolverAdicionais','agruparPorGrupo','ehAdicionalGratis','cotaGratis','resolverPrecoAdicionais'];
  assert.deepStrictEqual(Object.keys(addonsNS).sort(), [...expected].sort());
});

/* ── (F) PIN CRUZADO addons×pricing (sem NaN na fronteira) ───────────────── */
check('F resolverPrecoAdicionais alimenta somaAdicionais sem NaN', ()=>{
  const sels = [
    [{id:'a',tipo:'gratis',preco:2.00},{id:'b',tipo:'gratis',preco:2.00},{id:'c',tipo:'gratis',preco:2.00}],
    [{id:'a',tipo:'pago',preco:8},{id:'b',tipo:'gratis'}],            // preco ausente no grátis excedente
    [{id:'a',tipo:'pago'}],                                            // pago sem preco → Number(undefined)||0
    [],
  ];
  for (const sel of sels) {
    const total = somaAdicionais(resolverPrecoAdicionais(sel, 1, ehAdicionalGratis));
    assert.ok(Number.isFinite(total), `total não-finito p/ sel ${JSON.stringify(sel)}: ${total}`);
  }
});

console.log(fail===0 ? '✅ addons.golden OK — snapshot + pureza + idempotência + taxonomia + guard-imports + pin-cruzado' : `❌ ${fail} falha(s)`);
process.exit(fail===0 ? 0 : 1);
