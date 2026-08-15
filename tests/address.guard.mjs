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
     (7) O AddressModal monolítico foi removido (decomposição efetiva).
     (9) REF-ADDRESS-02 · Onda 2 — addressRepository.js é o ÚNICO lugar que fala com o RPC
         save_structured_address (mesmo princípio da (1)/(2), agora para a persistência estruturada).
     (10) REF-ADDRESS-02 · Onda 3 — geocodingService.js delega sugestoes/reverso ao waterfallGeocoder
          (não chama nominatimService direto); Mapbox/Photon preservam as URLs externas EXATAS; Mapbox
          fica indisponível sem VITE_MAPBOX_TOKEN (modo degradado, nunca quebra sem a chave).
     (11) REF-ADDRESS-02 · Onda 4 — gazetteerCorrector.js é o ÚNICO lugar que fala com a RPC
          buscar_gazetteer; nunca lança (degrada pra query original); waterfallGeocoder só o chama
          depois de TODOS os providers voltarem vazios (D-GAZETTEER-ORDER).
     (12) REF-DELIVERY-FEE-02 (auditoria forense) — enderecoPlausivel.js (filtro que rejeita rio/lago/
          POI/obra/área geográfica como coordenada de entrega) é PURO e GENÉRICO: sem React/fetch/
          localStorage/window, e sem nenhuma referência a loja/cidade específica (Encanto/Timbó/Indaial)
          nem a default_store_id() — a regra vale igual pra qualquer tenant/endereço; e o waterfall é
          quem a aplica (import único), nunca os providers individuais. */
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
  for (const f of ['address/validators/addressValidators.js', 'address/utils/addressFormat.js', 'address/utils/coordinates.js', 'address/utils/addressErrors.js']) {
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

/* (9) REF-ADDRESS-02 · Onda 2 — persistência estruturada isolada no repository */
check('(9) addressRepository é o único lugar que chama save_structured_address', () => {
  const REPO = 'address/repository/addressRepository.js';
  const outros = files.filter((f) => f.startsWith('address/') && f !== REPO);
  const comRpc = outros.filter((f) => /save_structured_address/.test(strip(read(f))));
  assert.deepStrictEqual(comRpc, [], `save_structured_address referenciada fora do repository: ${JSON.stringify(comRpc)}`);
  const repo = strip(read(REPO));
  assert.ok(/db\.rpc\(\s*['"]save_structured_address['"]/.test(repo), 'repository deve chamar a RPC save_structured_address via db.rpc');
  assert.ok(/from\s+['"]\.\.\/\.\.\/lib\/supabase\.js['"]/.test(repo), 'repository deve usar o mesmo cliente db de lib/supabase.js (mesmo padrão de create_order)');
});

/* (10) REF-ADDRESS-02 · Onda 3 — waterfall de geocoding: delegação + URLs preservadas + Mapbox degradado sem token */
check('(10) geocodingService delega ao waterfallGeocoder (não fala com nominatimService direto)', () => {
  const svc = strip(read('address/services/geocodingService.js'));
  assert.ok(/from\s+['"]\.\/geocoding\/waterfallGeocoder\.js['"]/.test(svc), 'geocodingService deve importar de ./geocoding/waterfallGeocoder.js');
  assert.ok(!/from\s+['"]\.\/nominatimService\.js['"]/.test(svc), 'geocodingService NÃO deve mais importar nominatimService direto (delega ao waterfall)');
  assert.ok(/waterfallGeocoder\.sugestoes/.test(svc) && /waterfallGeocoder\.reverso/.test(svc), 'sugestoes/reverso devem delegar ao waterfallGeocoder');
});
check('(10) providers do waterfall preservam as URLs externas EXATAS (Photon/Mapbox)', () => {
  const photon = read('address/services/geocoding/providers/photonProvider.js');
  assert.ok(photon.includes('https://photon.komoot.io/api/'), 'URL de busca do Photon');
  assert.ok(photon.includes('https://photon.komoot.io/reverse'), 'URL de reverse do Photon');
  const mapbox = read('address/services/geocoding/providers/mapboxProvider.js');
  assert.ok(mapbox.includes('https://api.mapbox.com/geocoding/v5/mapbox.places/'), 'URL do Mapbox Geocoding v5');
});
check('(10) Mapbox fica indisponível sem VITE_MAPBOX_TOKEN (modo degradado, nunca quebra sem a chave)', () => {
  const mapbox = strip(read('address/services/geocoding/providers/mapboxProvider.js'));
  assert.ok(/VITE_MAPBOX_TOKEN/.test(mapbox), 'deve ler VITE_MAPBOX_TOKEN do env');
  assert.ok(/disponivel:\s*\(\)\s*=>\s*!!TOKEN/.test(mapbox), 'disponivel() deve depender só da presença do token');
});
check('(10) waterfall.reverso lança em falha total (preserva o contrato original — confirmMap propaga sem try/catch)', () => {
  const wf = strip(read('address/services/geocoding/waterfallGeocoder.js'));
  assert.ok(/throw ultimoErro/.test(wf), 'reverso deve lançar (nunca devolver null) quando todos os provedores falham');
});

/* (11) REF-ADDRESS-02 · Onda 4 — gazetteer isolado */
check('(11) gazetteerCorrector é o único lugar que chama buscar_gazetteer', () => {
  const ARQ = 'address/services/geocoding/gazetteerCorrector.js';
  const outros = files.filter((f) => f.startsWith('address/') && f !== ARQ);
  const comRpc = outros.filter((f) => /buscar_gazetteer/.test(strip(read(f))));
  assert.deepStrictEqual(comRpc, [], `buscar_gazetteer referenciada fora do gazetteerCorrector: ${JSON.stringify(comRpc)}`);
  const corretor = strip(read(ARQ));
  assert.ok(/db\.rpc\(\s*['"]buscar_gazetteer['"]/.test(corretor), 'gazetteerCorrector deve chamar a RPC buscar_gazetteer via db.rpc');
  assert.ok(/catch\s*\{\s*return query;\s*\}/.test(corretor), 'gazetteerCorrector nunca deve lançar — falha degrada pra query original');
});
check('(11) waterfall só chama o corretor DEPOIS de todos os providers (D-GAZETTEER-ORDER)', () => {
  const wf = strip(read('address/services/geocoding/waterfallGeocoder.js'));
  const idxTentarProviders = wf.indexOf('async function tentarProviders');
  const idxSugestoes = wf.indexOf('async function sugestoes');
  // REF-SAAS-01 · Onda 6.3: corrigirFn ganhou um 2º argumento (bias de cidade) — regex tolera a vírgula.
  const idxCorrigirFn = wf.search(/corrigirFn\(query\b/);
  assert.ok(idxTentarProviders > -1 && idxSugestoes > idxTentarProviders, 'tentarProviders deve existir antes de sugestoes usá-lo');
  assert.ok(idxCorrigirFn > wf.indexOf('const primeira'), 'correção via gazetteer só pode ser chamada depois da 1ª tentativa (primeira)');
});

/* (12) REF-DELIVERY-FEE-02 — filtro de plausibilidade puro, genérico e usado só pelo waterfall */
check('(12) enderecoPlausivel.js é puro (sem React/fetch/localStorage/window)', () => {
  const code = strip(read('address/services/geocoding/enderecoPlausivel.js'));
  assert.ok(!/from ['"]react['"]/.test(code), 'não pode importar React');
  assert.ok(!/\bfetch\s*\(|localStorage|window\./.test(code), 'não pode tocar IO/browser');
});
check('(12) enderecoPlausivel.js não referencia nenhum tenant/cidade específico nem default_store_id()', () => {
  const raw = read('address/services/geocoding/enderecoPlausivel.js'); // RAW: nem em comentário pode aparecer
  for (const proibido of ['Encanto', 'Timbó', 'Timbo', 'Indaial', 'default_store_id']) {
    assert.ok(!raw.includes(proibido), `referência proibida encontrada: "${proibido}"`);
  }
});
check('(12) waterfallGeocoder é o único ponto que aplica o filtro (providers individuais não filtram)', () => {
  const wf = strip(read('address/services/geocoding/waterfallGeocoder.js'));
  assert.ok(/from\s+['"]\.\/enderecoPlausivel\.js['"]/.test(wf), 'waterfall deve importar enderecoPlausivel.js');
  assert.ok(/resultadoEhEnderecoPlausivel/.test(wf), 'waterfall deve aplicar resultadoEhEnderecoPlausivel');
  for (const f of ['address/services/geocoding/providers/nominatimProvider.js', 'address/services/geocoding/providers/photonProvider.js', 'address/services/geocoding/providers/mapboxProvider.js']) {
    assert.ok(!/enderecoPlausivel/.test(strip(read(f))), `${f} não deve filtrar por conta própria (responsabilidade é só do waterfall)`);
  }
});

console.log(fail === 0
  ? '\nOK address.guard — domínio isolado (I/O nos services; interface sem fetch; StoreApp desacoplado)'
  : `\nFALHA address.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
