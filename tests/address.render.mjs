/* tests/address.render.mjs — REF-ADDRESS-01. Roda: node tests/address.render.mjs (npm run test:address-render)
   PROVA DE ZERO-DRIFT VISUAL do domínio Address. Renderiza os componentes via react-dom/server
   (renderToStaticMarkup) e compara com markup CONGELADO. Mesmo motor/estilo do tests/render.smoke.mjs.

   CASO ÂNCORA: `AddressModal (aba search)` — o snapshot é o markup capturado do AddressModal MONOLÍTICO
   ORIGINAL (antes da decomposição). O AddressModal novo (orquestrador + abas) tem de reproduzi-lo
   BYTE-A-BYTE — prova mecânica de que a refatoração não mudou a interface no estado inicial. Os demais
   casos congelam as abas/peças decompostas (CEP encontrado, mapa, não encontrado) como guarda de
   regressão contínua. Sem DOM/rede/browser: efeitos (foco, Leaflet) não rodam no render estático. */
import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./_render-loader.mjs', import.meta.url);
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const h = React.createElement;
const NBSP = String.fromCharCode(160);
const norm = (s) => s.split(NBSP).join(' ');

const { AddressModal } = await import('../src/address/index.js');
const { AddressPreview } = await import('../src/address/components/AddressPreview.jsx');
const { AddressActions } = await import('../src/address/components/AddressActions.jsx');
const { AddressForm } = await import('../src/address/components/AddressForm.jsx');
const { AddressMap } = await import('../src/address/components/AddressMap.jsx');
const { AddressSearch } = await import('../src/address/components/AddressSearch.jsx');
const { AddressSummary } = await import('../src/address/components/AddressSummary.jsx');

const noop = () => {};
const cepData = { logradouro: 'Rua das Flores', bairro: 'Centro', localidade: 'Timbó', uf: 'SC', cep: '89120-000' };

/* ── ÂNCORA: markup do AddressModal ORIGINAL (monólito), aba 'search'/idle — o novo deve igualar ── */
const GOLDEN_MODAL_SEARCH =
`<div class="addr-modal-overlay"><div class="addr-modal" style="max-width:500px"><div class="addr-modal-head"><span class="addr-modal-title">📍 Onde receber seu pedido?</span><button class="addr-modal-close">✕</button></div><div style="display:flex;border-bottom:1px solid var(--gray-100);background:var(--gray-50)"><button style="flex:1;padding:10px 4px;border:none;background:none;cursor:pointer;font-size:11px;font-weight:700;font-family:var(--font-body);border-bottom:2px solid var(--grape);color:var(--grape);transition:all .15s">🔍 Buscar endereço</button><button style="flex:1;padding:10px 4px;border:none;background:none;cursor:pointer;font-size:11px;font-weight:700;font-family:var(--font-body);border-bottom:2px solid transparent;color:var(--gray-500);transition:all .15s">📮 Buscar por CEP</button><button style="flex:1;padding:10px 4px;border:none;background:none;cursor:pointer;font-size:11px;font-weight:700;font-family:var(--font-body);border-bottom:2px solid transparent;color:var(--gray-500);transition:all .15s">🗺️ Ver no mapa</button></div><div class="addr-modal-body"><input class="addr-search-input" placeholder="Rua, número, bairro ou local..." value=""/><button class="addr-gps-btn"><span>🎯</span> Usar minha localização atual</button><div style="margin-top:12px"><div class="addr-section-label">Dicas de busca</div><div style="font-size:12px;color:var(--gray-500);line-height:1.8;padding:4px 0">• Ex: <b>Rua das Flores, 123</b><br/>• Ex: <b>João Schlay 77</b><br/>• Ex: <b>Testo Central, Timbó</b></div></div></div></div></div>`;

const GOLDEN_PREVIEW =
`<div style="background:var(--grape-pale);border-radius:10px;padding:12px 14px;border:1px solid #DDD6FE;margin-bottom:12px"><div style="font-weight:700;font-size:14px;color:var(--amarelo);margin-bottom:4px">✅ CEP encontrado</div><div style="font-size:13px;color:var(--gray-700);line-height:1.7"><b>Rua das Flores</b><br/>Centro · Timbó/SC</div></div>`;

const GOLDEN_ACTIONS = `<button class="addr-confirm-btn">✅ Confirmar endereço</button>`;

const GOLDEN_FORM_FOUND =
`<label style="font-size:12px;font-weight:700;color:var(--gray-600);display:block;margin-bottom:6px">CEP</label><input class="addr-search-input" placeholder="00000-000" maxLength="9" value="89120-000"/><div style="margin-top:12px"><div style="background:var(--grape-pale);border-radius:10px;padding:12px 14px;border:1px solid #DDD6FE;margin-bottom:12px"><div style="font-weight:700;font-size:14px;color:var(--amarelo);margin-bottom:4px">✅ CEP encontrado</div><div style="font-size:13px;color:var(--gray-700);line-height:1.7"><b>Rua das Flores</b><br/>Centro · Timbó/SC</div></div><label style="font-size:12px;font-weight:700;color:var(--gray-600);display:block;margin-bottom:4px">Número da residência <span style="color:var(--orange)">*</span></label><input class="addr-search-input" style="margin-bottom:8px" placeholder="Ex: 77" value="77"/><label style="font-size:12px;font-weight:700;color:var(--gray-600);display:block;margin-bottom:4px">Complemento (opcional)</label><input class="addr-search-input" style="margin-bottom:12px" placeholder="Ex: Casa 02, Ap 301" value="Casa 02"/><button class="addr-confirm-btn">✅ Confirmar endereço</button></div>`;

const GOLDEN_MAP =
`<p style="font-size:12px;color:var(--gray-500);margin-bottom:8px;line-height:1.5">Clique ou arraste o marcador para marcar seu endereço.</p><div class="addr-map-container" style="height:300px"><div style="width:100%;height:100%"></div></div><div style="margin-top:8px;padding:8px 12px;background:var(--grape-pale);border-radius:8px;font-size:13px;color:var(--amarelo);font-weight:600">📍 Rua X, 10</div><label style="font-size:12px;font-weight:700;color:var(--gray-600);display:block;margin:10px 0 4px">Número da residência</label><input class="addr-search-input" style="margin-bottom:10px" placeholder="Ex: 77" value=""/><button class="addr-confirm-btn">✅ Confirmar localização no mapa</button><p style="font-size:10px;color:var(--gray-400);text-align:center;margin-top:6px">Lat: -26.79500 · Lng: -49.27000</p>`;

const GOLDEN_SEARCH_NOTFOUND =
`<input class="addr-search-input" placeholder="Rua, número, bairro ou local..." value="xyz"/><button class="addr-gps-btn"><span>🎯</span> Usar minha localização atual</button><div class="addr-not-found"><div style="font-size:28px;margin-bottom:6px">🔍</div><p><b>Endereço não encontrado.</b><br/>Tente buscar pelo CEP ou marque no mapa.</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px"><button class="addr-map-btn">📮 Buscar por CEP</button><button class="addr-map-btn">🗺️ Ver no mapa</button></div></div>`;

/* REF-CHECKOUT-ADDRESS-01: AddressSummary (resumo editável do checkout — 3 estados) */
const enderecoFix = { label: 'Rua das Flores, 123', bairro: 'Centro', cidade: 'Timbó', complemento: 'Casa 02' };
const RETIRADA_LABEL = 'Rua João Schlay, 77 Casa 02';
/* REF-CHECKOUT-ADDRESS-01 (fix adversarial): o cartao mostra SO o label persistido — exibido == persistido. */
const GOLDEN_SUMMARY_ENTREGA =
`<div style="display:flex;align-items:center;gap:12px;justify-content:space-between;background:var(--grape-pale);border:1px solid #DDD6FE;border-radius:12px;padding:12px 14px"><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px;color:var(--gray-700);line-height:1.4">📍 Rua das Flores, 123</div></div><button type="button" style="flex-shrink:0;border:1px solid var(--grape);background:none;color:var(--grape);font-weight:700;font-size:12px;border-radius:8px;padding:7px 12px;cursor:pointer;font-family:var(--font-body)">Alterar</button></div>`;
const GOLDEN_SUMMARY_VAZIO =
`<div style="background:var(--gray-50);border:1px dashed var(--gray-200, #E5E7EB);border-radius:12px;padding:14px;text-align:center"><div style="font-size:12px;color:var(--gray-500);margin-top:0;line-height:1.5">Você ainda não escolheu um endereço de entrega.</div><button type="button" class="addr-confirm-btn" style="margin-top:10px">📍 Selecionar endereço</button></div>`;
const GOLDEN_SUMMARY_RETIRADA =
`<div style="display:flex;align-items:center;gap:12px;justify-content:space-between;background:var(--grape-pale);border:1px solid #DDD6FE;border-radius:12px;padding:12px 14px"><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px;color:var(--gray-700);line-height:1.4">🏪 Rua João Schlay, 77 Casa 02</div><div style="font-size:12px;color:var(--gray-500);margin-top:2px;line-height:1.5">Você retira o pedido no balcão da loja.</div></div></div>`;

const CASES = [
  { nome: 'AddressModal (aba search = golden do monólito original)', el: () => h(AddressModal, { onClose: noop, onSelect: noop }), snap: GOLDEN_MODAL_SEARCH },
  { nome: 'AddressPreview', el: () => h(AddressPreview, { cepData }), snap: GOLDEN_PREVIEW },
  { nome: 'AddressActions', el: () => h(AddressActions, { onConfirm: noop, label: '✅ Confirmar endereço' }), snap: GOLDEN_ACTIONS },
  { nome: 'AddressForm(found)', el: () => h(AddressForm, { cepQuery: '89120-000', onCepChange: noop, status: 'found', cepData, cepNumero: '77', onNumeroChange: noop, complemento: 'Casa 02', onComplementoChange: noop, onConfirm: noop }), snap: GOLDEN_FORM_FOUND },
  { nome: 'AddressMap', el: () => h(AddressMap, { mapPin: { lat: -26.795, lng: -49.27 }, mapAddr: 'Rua X, 10', cepNumero: '', onNumeroChange: noop, onConfirm: noop, aoArrastarPino: noop, aoClicarPino: noop }), snap: GOLDEN_MAP },
  { nome: 'AddressSearch(notfound)', el: () => h(AddressSearch, { query: 'xyz', onQueryChange: noop, status: 'notfound', suggestions: [], onGPS: noop, onPick: noop, onGoCep: noop, onGoMap: noop }), snap: GOLDEN_SEARCH_NOTFOUND },
  { nome: 'AddressSummary(entrega+endereco)', el: () => h(AddressSummary, { endereco: enderecoFix, retirada: false, retiradaLabel: RETIRADA_LABEL, onEditar: noop }), snap: GOLDEN_SUMMARY_ENTREGA },
  { nome: 'AddressSummary(entrega+vazio)', el: () => h(AddressSummary, { endereco: null, retirada: false, retiradaLabel: RETIRADA_LABEL, onEditar: noop }), snap: GOLDEN_SUMMARY_VAZIO },
  { nome: 'AddressSummary(retirada)', el: () => h(AddressSummary, { endereco: null, retirada: true, retiradaLabel: RETIRADA_LABEL, onEditar: noop }), snap: GOLDEN_SUMMARY_RETIRADA },
];

let fail = 0;
for (const c of CASES) {
  const got = renderToStaticMarkup(c.el());
  try { assert.strictEqual(norm(got), norm(c.snap)); console.error('  ok ' + c.nome); }
  catch { fail++; console.error('  x  ' + c.nome + ' — markup divergiu\n    esperado: ' + c.snap + '\n    obtido:   ' + got); }
}
console.log(fail === 0 ? '\nOK address.render — ' + CASES.length + ' caso(s); AddressModal byte-igual ao monólito original' : '\nFALHA address.render — ' + fail + ' caso(s)');
process.exit(fail ? 1 : 0);
