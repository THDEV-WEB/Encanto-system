/* tests/address.unit.mjs — REF-ADDRESS-01. Roda: node tests/address.unit.mjs (npm run test:address)
   Testa a CAMADA PURA do domínio Address (validators + utils) — importável em Node puro (sem React/IO).
   Cada asserção congela a saída EXATA que os handlers do AddressModal original produziam inline, provando
   que a extração para utils/validators é equivalente (zero mudança de comportamento). */
import assert from 'node:assert/strict';
import { cepValido, queryValida, numeroPreenchido, respostaCepOk, coordenadasValidas } from '../src/address/validators/addressValidators.js';
import { CENTRO_PADRAO, formatarCoord, dentroDaArea } from '../src/address/utils/coordinates.js';
import {
  normalizarEndereco, chaveDedupe, sugestaoMain, sugestaoSub, curtaSugestao, curtaGps, curtaCep,
  linhaReversaMapa, linhaConfirmarMapa,
} from '../src/address/utils/addressFormat.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

/* ── Validators (reproduzem as guardas inline originais) ── */
check('cepValido: exige 8 dígitos', () => {
  assert.equal(cepValido('89120-000'), true);
  assert.equal(cepValido('89120000'), true);
  assert.equal(cepValido('8912000'), false);   // 7
  assert.equal(cepValido('891200000'), false); // 9
  assert.equal(cepValido(''), false);
  assert.equal(cepValido(null), false);
});
check('queryValida: mínimo 3 chars', () => {
  assert.equal(queryValida('abc'), true);
  assert.equal(queryValida('ab'), false);
  assert.equal(queryValida(''), false);
  assert.equal(queryValida(null), false);
});
check('numeroPreenchido: trim não-vazio', () => {
  assert.equal(numeroPreenchido('77'), true);
  assert.equal(numeroPreenchido('  '), false);
  assert.equal(numeroPreenchido(''), false);
  assert.equal(numeroPreenchido(null), false);
});
check('respostaCepOk: acerto do ViaCEP', () => {
  assert.equal(respostaCepOk({ logradouro: 'x' }), true);
  assert.equal(respostaCepOk({ erro: true }), false);
  assert.equal(respostaCepOk(null), false);
});
check('coordenadasValidas: finitas e dentro dos limites (preparo/segurança)', () => {
  assert.equal(coordenadasValidas(-26.7, -49.2), true);
  assert.equal(coordenadasValidas(NaN, 0), false);
  assert.equal(coordenadasValidas(200, 0), false);
  assert.equal(coordenadasValidas('a', 'b'), false);
});

/* ── Coordinates ── */
check('CENTRO_PADRAO = mapPin inicial do original', () => {
  assert.deepEqual(CENTRO_PADRAO, { lat: -26.795, lng: -49.270 });
});
check('formatarCoord = toFixed(5)', () => {
  assert.equal(formatarCoord(-26.795), '-26.79500');
  assert.equal(formatarCoord(-49.27), '-49.27000');
});
check('dentroDaArea: semântica do inRange original PRESERVADA (inclui o quirk herdado)', () => {
  assert.equal(dentroDaArea(-26.7, -48.9), true);    // lat ok; lng passa nos dois >= (quirk original)
  assert.equal(dentroDaArea(-26.7, -49.6), false);   // lng < -49.5
  assert.equal(dentroDaArea(-26.4, -48.9), false);   // lat > -26.5
});

/* ── addressFormat (congelam as strings dos call-sites originais) ── */
const a = { road: 'Rua João Schlay', house_number: '77', suburb: 'Centro', neighbourhood: 'Bairro X', city: 'Timbó', town: 'Timbozinho', municipality: 'Muni', quarter: 'Q', state: 'Santa Catarina', postcode: '89120-000' };
const s = { address: a, display_name: 'Rua João Schlay, 77, Centro, Timbó, SC', lat: '-26.7', lon: '-49.2' };

check('normalizarEndereco: variante enxuta (GPS) x completa (pick)', () => {
  assert.deepEqual(normalizarEndereco(a), { rua: 'Rua João Schlay', numero: '77', bairro: 'Centro', cidade: 'Timbó', estado: 'Santa Catarina', cep: '89120-000' });
  const b = { road: 'R', house_number: '1', quarter: 'Q', municipality: 'M', state: 'SC', postcode: '' };
  assert.deepEqual(normalizarEndereco(b), { rua: 'R', numero: '1', bairro: '', cidade: 'Timbó', estado: 'SC', cep: '' });
  assert.deepEqual(normalizarEndereco(b, { completa: true }), { rua: 'R', numero: '1', bairro: 'Q', cidade: 'M', estado: 'SC', cep: '' });
});
check('chaveDedupe = road,house_number', () => {
  assert.equal(chaveDedupe(s), 'Rua João Schlay,77');
  assert.equal(chaveDedupe({ address: {} }), ',');
});
check('sugestaoMain / sugestaoSub', () => {
  assert.equal(sugestaoMain(s), 'Rua João Schlay, 77');
  assert.equal(sugestaoMain({ address: {}, display_name: 'Somewhere, City' }), 'Somewhere');
  assert.equal(sugestaoSub(s), 'Centro · Timbó · CEP 89120-000');
});
check('curtaSugestao (pick)', () => {
  assert.equal(curtaSugestao(normalizarEndereco(a, { completa: true }), s), 'Rua João Schlay, 77 — Centro');
  assert.equal(curtaSugestao({ rua: '', numero: '', bairro: '' }, { display_name: 'A, B, C, D' }), 'A, B');
});
check('curtaGps', () => {
  assert.equal(curtaGps(a, s), 'Rua João Schlay, 77');
  assert.equal(curtaGps({}, { display_name: 'X, Y' }), 'X');
  assert.equal(curtaGps({}, {}), '');
});
check('curtaCep (com e sem complemento)', () => {
  const cepData = { logradouro: 'Rua X', bairro: 'Centro' };
  assert.equal(curtaCep(cepData, '77', 'Casa 02'), 'Rua X, 77 Casa 02 — Centro');
  assert.equal(curtaCep(cepData, ' 88 ', ''), 'Rua X, 88 — Centro');
});
check('linhaReversaMapa x linhaConfirmarMapa (diferença suburb||neighbourhood vs suburb preservada)', () => {
  assert.equal(linhaReversaMapa(a), 'Rua João Schlay, 77, Centro, Timbó');
  assert.equal(linhaConfirmarMapa(a), 'Rua João Schlay, 77, Centro, Timbó');
  const c = { road: 'R', house_number: '1', neighbourhood: 'N', city: 'C' };
  assert.equal(linhaReversaMapa(c), 'R, 1, N, C');   // usa neighbourhood
  assert.equal(linhaConfirmarMapa(c), 'R, 1, C');    // só suburb (ausente) -> pulado
});

console.log(fail === 0 ? '\nOK address.unit — validators + utils congelados (equivalência ao original)' : '\nFALHA address.unit — ' + fail + ' caso(s)');
process.exit(fail ? 1 : 0);
