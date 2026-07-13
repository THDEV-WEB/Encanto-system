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

/* (3) StoreApp perdeu a responsabilidade de endereço */
check('(3) StoreApp consome o domínio e não toca mais no localStorage de endereço', () => {
  const store = strip(read('pages/StoreApp.jsx'));
  assert.ok(!/components\/AddressModal/.test(store), 'StoreApp não deve importar o AddressModal antigo');
  assert.ok(/\.\.\/address\/index\.js/.test(store), 'StoreApp deve importar o domínio address (barrel)');
  assert.ok(/useAddress/.test(store), 'StoreApp deve usar o hook useAddress');
  assert.ok(!/DELIVERY_ADDRESS/.test(store), 'StoreApp não deve referenciar DELIVERY_ADDRESS (movido p/ useAddress)');
  assert.ok(!/DELIVERY_META/.test(store), 'StoreApp não deve referenciar DELIVERY_META (movido p/ useAddress)');
});

/* (4) persistência no hook useAddress */
check('(4) useAddress é dono da persistência do endereço (DELIVERY_ADDRESS/META)', () => {
  const h = strip(read('address/hooks/useAddress.js'));
  assert.ok(/DELIVERY_ADDRESS/.test(h) && /DELIVERY_META/.test(h), 'useAddress deve persistir as duas chaves');
  assert.ok(/localStorage/.test(h), 'useAddress usa localStorage (persistência local, não fonte de verdade)');
});

/* (5) barrel = fronteira única */
check('(5) barrel expõe AddressModal + useAddress', () => {
  const idx = strip(read('address/index.js'));
  assert.ok(/AddressModal/.test(idx), 'barrel exporta AddressModal');
  assert.ok(/useAddress/.test(idx), 'barrel exporta useAddress');
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
