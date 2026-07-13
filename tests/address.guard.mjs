/* tests/address.guard.mjs — REF-ADDRESS-01. Roda: node tests/address.guard.mjs (npm run test:address-guard)
   GUARDA ESTRUTURAL da arquitetura do domínio Address. Análise estática pura (sem banco/rede). Falha se
   alguém reintroduzir I/O na interface, quebrar a fronteira do domínio ou devolver ao StoreApp a
   responsabilidade de endereço. Invariantes:
     (1) Nenhum componente/hook do domínio faz `fetch` — todo I/O externo vive em address/services/.
     (2) Os services preservam as URLs externas EXATAS (ViaCEP, Nominatim busca+reverso, Leaflet CDN, tiles).
     (3) StoreApp consome o domínio (address/ + useAddress) e NÃO toca mais no localStorage de endereço
         (DELIVERY_ADDRESS/DELIVERY_META) nem importa o AddressModal antigo.
     (4) A persistência do endereço vive no hook useAddress (fonte da sincronização local).
     (5) O barrel expõe AddressModal + useAddress (fronteira única do domínio).
     (6) validators/ e utils/ são PUROS (sem React/JSX/fetch/localStorage/window) — lógica reutilizável.
     (7) O AddressModal monolítico foi removido (decomposição efetiva). */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (f) => readFileSync(SRC + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const files = readdirSync(SRC, { recursive: true }).map((f) => String(f).replace(/\\/g, '/')).filter((f) => /\.(js|jsx)$/.test(f)).sort();
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

/* (1) I/O só nos services */
check('(1) nenhum componente/hook do domínio faz fetch (I/O só em services)', () => {
  const naoService = files.filter((f) => f.startsWith('address/') && !f.startsWith('address/services/'));
  const comFetch = naoService.filter((f) => /\bfetch\s*\(/.test(strip(read(f))));
  assert.deepStrictEqual(comFetch, [], `fetch fora dos services: ${JSON.stringify(comFetch)}`);
  assert.ok(/\bfetch\s*\(/.test(strip(read('address/services/viaCepService.js'))), 'viaCepService deve conter o fetch de CEP');
  assert.ok(/\bfetch\s*\(/.test(strip(read('address/services/nominatimService.js'))), 'nominatimService deve conter os fetch de geocoding');
});

/* (2) URLs externas exatas preservadas — lê RAW (strip removeria `//` das URLs https://) */
check('(2) services preservam as URLs externas EXATAS', () => {
  const viacep = read('address/services/viaCepService.js');
  assert.ok(viacep.includes('https://viacep.com.br/ws/'), 'URL do ViaCEP');
  const nom = read('address/services/nominatimService.js');
  assert.ok(nom.includes('https://nominatim.openstreetmap.org'), 'host do Nominatim');
  assert.ok(nom.includes('/reverse?format=json&lat='), 'endpoint reverse do Nominatim');
  assert.ok(/\/search/.test(nom), 'endpoint search do Nominatim');
  const mapsvc = read('address/services/mapService.js');
  assert.ok(mapsvc.includes('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'), 'Leaflet JS (unpkg)');
  assert.ok(mapsvc.includes('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'), 'Leaflet CSS (unpkg)');
  assert.ok(mapsvc.includes('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'), 'tiles OSM');
});

/* (3) StoreApp perdeu a responsabilidade de endereço (REF-CHECKOUT-ADDRESS-01: consome o provider) */
check('(3) StoreApp consome o provider e não toca no localStorage de endereço', () => {
  const store = strip(read('pages/StoreApp.jsx'));
  assert.ok(!/components\/AddressModal/.test(store), 'StoreApp não deve importar o AddressModal antigo');
  assert.ok(/AddressProvider/.test(store), 'StoreApp deve envolver a loja no AddressProvider (fonte única)');
  assert.ok(/useAddress/.test(store), 'StoreApp deve consumir useAddress');
  assert.ok(!/<AddressModal/.test(store), 'StoreApp não deve renderizar o AddressModal (agora é do provider)');
  assert.ok(!/DELIVERY_ADDRESS/.test(store) && !/DELIVERY_META/.test(store), 'StoreApp não referencia chaves de endereço');
});

/* (4) FONTE ÚNICA: persistência no AddressProvider (chave única) + useAddress = consumidor de contexto */
check('(4) AddressProvider é dono da persistência (chave única DELIVERY) e useAddress só consome contexto', () => {
  const prov = strip(read('address/AddressProvider.jsx'));
  assert.ok(/STORAGE_KEYS\.DELIVERY\b/.test(prov), 'provider persiste na chave única DELIVERY');
  assert.ok(/AddressContext/.test(prov) && /Provider/.test(prov), 'provider expõe o AddressContext');
  assert.ok(/DELIVERY_ADDRESS/.test(prov) && /removeItem/.test(prov), 'provider migra e remove os legados (uma fonte)');
  const h = strip(read('address/hooks/useAddress.js'));
  assert.ok(/useContext\(AddressContext\)/.test(h), 'useAddress deve consumir o AddressContext');
  assert.ok(!/useState|localStorage/.test(h), 'useAddress NÃO pode ter estado/persistência próprios (senão vira 2ª fonte)');
});

/* (5) barrel = fronteira única */
check('(5) barrel expõe AddressProvider + AddressModal + AddressSummary + useAddress', () => {
  const idx = strip(read('address/index.js'));
  for (const ex of ['AddressProvider', 'AddressModal', 'AddressSummary', 'useAddress']) {
    assert.ok(new RegExp(ex).test(idx), `barrel deve exportar ${ex}`);
  }
});

/* (8) FONTE ÚNICA no checkout: consome useAddress, sem textarea próprio; pedido usa o endereço do domínio */
check('(8) CheckoutPage consome a fonte única e não tem endereço próprio (sem textarea/form.endereco)', () => {
  const ck = strip(read('components/checkout/CheckoutPage.jsx'));
  assert.ok(/useAddress/.test(ck), 'CheckoutPage deve consumir useAddress (fonte única)');
  assert.ok(!/upd\('endereco'/.test(ck) && !/form\.endereco/.test(ck), 'CheckoutPage não pode ter endereço próprio no form');
  assert.ok(!/obs-textarea[^>]*endereco|endereco[^>]*obs-textarea/.test(ck), 'sem textarea de endereço no checkout');
  const od = strip(read('utils/orderPayload.js'));
  assert.ok(/address:\s*endereco\b/.test(od), 'order-domain: address vem do parâmetro endereco (fonte única)');
  assert.ok(!/address:\s*form\.endereco/.test(od), 'order-domain: address NÃO pode vir de form.endereco');
});

/* (6) validators/utils puros */
check('(6) validators/ e utils/ são puros (sem React/JSX/fetch/localStorage/window)', () => {
  for (const f of ['address/validators/addressValidators.js', 'address/utils/addressFormat.js', 'address/utils/coordinates.js']) {
    const code = strip(read(f));
    assert.ok(!/from ['"]react['"]/.test(code), `${f} não pode importar React`);
    assert.ok(!/\.jsx['"]/.test(code), `${f} não pode importar JSX`);
    assert.ok(!/\bfetch\s*\(|localStorage|window\./.test(code), `${f} não pode tocar IO/browser`);
  }
});

/* (7) monólito removido */
check('(7) AddressModal monolítico foi removido', () => {
  assert.ok(!existsSync(SRC + 'components/AddressModal.jsx'), 'src/components/AddressModal.jsx deve ter sido removido');
});

console.log(fail === 0
  ? '\nOK address.guard — domínio isolado (I/O nos services; interface sem fetch; StoreApp desacoplado)'
  : `\nFALHA address.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
