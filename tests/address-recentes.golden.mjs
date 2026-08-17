/* tests/address-recentes.golden.mjs — REF-ADDRESS-UX-01. Roda: node tests/address-recentes.golden.mjs
   GOLDEN dos ENDEREÇOS RECENTES: dedupe/ordenação (deduplicarRecentes, pura) + formatação
   (recenteMain/recenteSub) + meta de reuso (metaDeRecente) + guardas estruturais de isolamento
   (customer_id sempre explícito na query; convidado nunca busca). Sem rede/banco — mesmo padrão dos
   demais golden.mjs deste domínio. Cobre os 18 cenários pedidos na auditoria (Fase 12). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deduplicarRecentes, chaveDedupeRecente, recenteMain, recenteSub, metaDeRecente,
} from '../src/address/utils/addressFormat.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

/* fixtures — 100% fictícias, nenhum dado real de cliente */
const a = { id: 'a', rua: 'Rua Itajaí', numero: '357', bairro: 'Rio Morto', cidade: 'Indaial', estado: 'SC', cep: '89130-000', complemento: 'apto 12', referencia: 'perto do mercado', latitude: -26.895, longitude: -49.257, confidence: 'street_level', provider: 'photon', formatted_address: 'Rua Itajaí, 357, Rio Morto, Indaial, SC', created_at: '2026-08-15T10:00:00Z' };
const b = { id: 'b', rua: 'Rua Blumenau', numero: '120', bairro: 'Centro', cidade: 'Timbó', estado: 'SC', cep: '89120-000', complemento: '', referencia: '', latitude: -26.85, longitude: -49.287, confidence: 'exact', provider: 'nominatim', formatted_address: 'Rua Blumenau, 120, Centro, Timbó, SC', created_at: '2026-08-14T10:00:00Z' };
const c = { id: 'c', rua: 'Rua das Palmeiras', numero: '5', bairro: 'Araponguinhas', cidade: 'Timbó', estado: 'SC', cep: '89121-000', complemento: '', referencia: '', latitude: null, longitude: null, confidence: 'unknown', provider: 'nominatim', formatted_address: '', created_at: '2026-08-13T10:00:00Z' };
/* mesma rua/numero/complemento/cep de `a`, mas gravada DEPOIS (reuso: nova linha, checkout atual) */
const aReusado = { ...a, id: 'a2', created_at: '2026-08-16T10:00:00Z' };

/* 1) cliente sem histórico */
check('1. cliente sem histórico -> lista vazia', () => {
  assert.deepEqual(deduplicarRecentes([]), []);
});

/* 2) cliente com 1 endereço */
check('2. cliente com 1 endereço -> 1 item', () => {
  const r = deduplicarRecentes([a]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'a');
});

/* 3) cliente com vários endereços distintos */
check('3. vários endereços distintos -> todos presentes, ordem preservada (created_at DESC já vem da query)', () => {
  const r = deduplicarRecentes([a, b, c]);
  assert.deepEqual(r.map(x => x.id), ['a', 'b', 'c']);
});

/* 4) máximo de 5 exibidos */
check('4. lote maior que 5 -> corta em 5', () => {
  const lote = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({ ...a, id, numero: String(i), created_at: `2026-08-${20 - i}T00:00:00Z` }));
  const r = deduplicarRecentes(lote, 5);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map(x => x.id), ['a', 'b', 'c', 'd', 'e']);
});

/* 5) ordenação por uso (a função confia na ordem de entrada = created_at DESC, não reordena por conta própria) */
check('5. ordenação: a função não reordena — quem ordena é a query (created_at DESC)', () => {
  const foraDeOrdem = [c, a, b]; // se a query mandar fora de ordem, a saída reflete a entrada
  assert.deepEqual(deduplicarRecentes(foraDeOrdem).map(x => x.id), ['c', 'a', 'b']);
});

/* 6) reutilização: mesma chave aparece 2x (linha nova mais recente primeiro, como create_at DESC manda) */
check('6. reutilização — mesmo endereço usado de novo (linha nova) não duplica, sobrevive a ocorrência mais recente', () => {
  const r = deduplicarRecentes([aReusado, b, a]); // aReusado (mais novo) primeiro, a (mais velho) por último
  assert.equal(r.length, 2, 'a e aReusado têm a MESMA chave — devem virar 1 só');
  assert.equal(r[0].id, 'a2', 'a ocorrência MAIS RECENTE (aReusado) é a que sobrevive');
});

/* 7) endereço volta ao topo ao ser reutilizado */
check('7. endereço reutilizado volta ao topo — created_at mais novo dele posiciona a linha em 1º', () => {
  // b é o "recente" mais novo antes do reuso; depois do reuso, aReusado (mais novo ainda) assume o topo
  const antes = deduplicarRecentes([b, a, c]);
  assert.equal(antes[0].id, 'b', 'antes do reuso, b é o mais recente');
  const depois = deduplicarRecentes([aReusado, b, c, a]); // simula: cliente reusou "a", nova linha é a mais recente
  assert.equal(depois[0].id, 'a2', 'depois do reuso, a linha nova de "a" assume o topo');
});

/* 8) deduplicação — chave exata (rua+numero+complemento+cep), variações de caixa/espaço não duplicam;
   variações reais (complemento diferente) NÃO são consideradas o mesmo endereço */
check('8a. chaveDedupeRecente ignora maiúsculas/espaços', () => {
  const x = { rua: '  Rua Itajaí  ', numero: '357', complemento: 'Apto 12', cep: '89130-000' };
  const y = { rua: 'rua itajaí', numero: '357', complemento: 'APTO 12', cep: '89130-000' };
  assert.equal(chaveDedupeRecente(x), chaveDedupeRecente(y));
});
check('8b. complemento diferente -> chaves diferentes (não é duplicata)', () => {
  const x = { rua: 'Rua Itajaí', numero: '357', complemento: 'Apto 12', cep: '89130-000' };
  const y = { rua: 'Rua Itajaí', numero: '357', complemento: 'Casa', cep: '89130-000' };
  assert.notEqual(chaveDedupeRecente(x), chaveDedupeRecente(y));
});

/* 9/10/11) isolamento por cliente/tenant — guarda estrutural: a query SEMPRE filtra por customer_id
   explícito (nunca confia só na RLS, mesmo padrão de PedidosClienteService), e nunca referencia
   store_id (decisão registrada: customer_id já é 1:1 por pessoa+loja na origem) */
const SVC = readFileSync(new URL('../src/services/AddressClienteService.js', import.meta.url), 'utf8');
check('9/10/11. AddressClienteService filtra SEMPRE por customer_id explícito (isolamento cliente/tenant)', () => {
  assert.ok(/\.eq\(\s*['"]customer_id['"]\s*,\s*customerId\s*\)/.test(SVC), 'query deve ter .eq(\'customer_id\', customerId) explícito');
  assert.ok(/if\s*\(!dbCliente\s*\|\|\s*!customerId\)\s*return\s*\[\]/.test(SVC), 'sem customerId, devolve [] sem consultar nada');
});

/* 12) convidado (não logado) nunca ganha histórico persistente — guarda estrutural no hook */
const HOOK = readFileSync(new URL('../src/hooks/useEnderecosRecentes.js', import.meta.url), 'utf8');
check('12. useEnderecosRecentes: convidado (isLogged=false ou sem customer.id) nunca busca — recentes fica []', () => {
  assert.ok(/if\s*\(!isLogged\s*\|\|\s*!customerId\)\s*\{\s*setRecentes\(\[\]\)/.test(HOOK), 'guest guard ausente/alterado');
});

/* 13) endereço com complemento — aparece na chave e seria restaurado no meta */
check('13. endereço com complemento — chave inclui o complemento, meta restaura o campo', () => {
  assert.notEqual(chaveDedupeRecente(a), chaveDedupeRecente({ ...a, complemento: '' }));
  assert.equal(metaDeRecente(a).complemento, 'apto 12');
});

/* 14) endereço com coordenadas — meta restaura lat/lng sem geocodificar de novo */
check('14. endereço com coordenadas — meta restaura lat/lng do registro, sem geocoder', () => {
  const meta = metaDeRecente(a);
  assert.equal(meta.lat, -26.895);
  assert.equal(meta.lng, -49.257);
});

/* 15) endereço sem coordenadas — meta não inventa lat/lng, propaga null */
check('15. endereço sem coordenadas -> meta.lat/lng ficam null (nunca inventa)', () => {
  const meta = metaDeRecente(c);
  assert.equal(meta.lat, null);
  assert.equal(meta.lng, null);
});

/* 16/17) checkout/taxa após selecionar histórico — meta tem o MESMO shape que confirmSearch já monta
   (routeDistanceService/deliveryFeeRules só leem endereco.lat/endereco.lng do objeto canônico — mesmo
   contrato, então continuam funcionando idênticos independente de a origem ser busca nova ou recente) */
check('16/17. metaDeRecente tem o mesmo shape de campos que a confirmação de busca (checkout/taxa continuam funcionando)', () => {
  const meta = metaDeRecente(a);
  const chavesEsperadas = ['lat', 'lng', 'rua', 'numero', 'bairro', 'cidade', 'estado', 'cep', 'complemento', 'referencia', 'full', 'provider', 'confidence'];
  for (const k of chavesEsperadas) assert.ok(k in meta, `meta deve ter a chave "${k}" (mesmo shape usado por routing/taxa)`);
});

/* 18) autocomplete continua funcionando para endereço novo — guarda: usarRecente não desliga/substitui
   o motor de busca (searchAddress/guardiaoBusca continuam intocados no hook — ver useAddressSearch.js) */
const ENGINE = readFileSync(new URL('../src/address/hooks/useAddressSearch.js', import.meta.url), 'utf8');
check('18. useAddressSearch: usarRecente é aditivo — searchAddress/guardiaoBusca continuam presentes e intocados', () => {
  assert.ok(/const searchAddress = useCallback/.test(ENGINE), 'searchAddress deve continuar existindo');
  assert.ok(/guardiaoBusca\.iniciar\(\)/.test(ENGINE), 'guarda de sequência da busca deve continuar existindo');
  assert.ok(/const usarRecente = useCallback\(\(r\) => \{\s*onSelect\(recenteMain\(r\), metaDeRecente\(r\)\);\s*\}, \[onSelect\]\);/.test(ENGINE), 'usarRecente deve ser síncrono (sem geocoder/rede)');
});

/* formatação — recenteMain/recenteSub (visual, mesmo padrão de sugestaoMain/sugestaoSub) */
check('recenteMain formata "Rua, número — Bairro"', () => {
  assert.equal(recenteMain(a), 'Rua Itajaí, 357 — Rio Morto');
});
check('recenteSub formata "Cidade/Estado · CEP ..."', () => {
  assert.equal(recenteSub(a), 'Indaial/SC · CEP 89130-000');
});
check('recenteSub sem CEP omite o segmento', () => {
  assert.equal(recenteSub({ cidade: 'Timbó', estado: 'SC' }), 'Timbó/SC');
});

console.log(fail === 0
  ? '\nOK address-recentes.golden — dedupe/ordenação/formatação/isolamento (18 cenários da Fase 12), sem rede'
  : `\nFALHA address-recentes.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
