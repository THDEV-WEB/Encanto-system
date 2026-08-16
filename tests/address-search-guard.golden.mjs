/* tests/address-search-guard.golden.mjs — REF-ADDRESS-AUTOCOMPLETE-01.
   Roda: node tests/address-search-guard.golden.mjs (npm run test:address-search-guard). Testa a guarda
   de sequência (searchGuard.js) que corrige a race condition da busca de endereço: com debounce, duas
   chamadas podem ficar em voo ao mesmo tempo e a rede pode entregar a resposta da mais ANTIGA depois da
   mais NOVA — sem a guarda, a resposta obsoleta sobrescreveria sugestões já atualizadas. Pura, sem
   React/rede — simula a ordem de chegada das respostas manualmente. */
import assert from 'node:assert/strict';
import { criarGuardiaoSequencia } from '../src/address/utils/searchGuard.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

check('iniciar() devolve um número novo a cada chamada', () => {
  const g = criarGuardiaoSequencia();
  const a = g.iniciar();
  const b = g.iniciar();
  assert.notEqual(a, b);
});

check('aindaValido: a sequência mais recente é sempre válida', () => {
  const g = criarGuardiaoSequencia();
  const seq = g.iniciar();
  assert.equal(g.aindaValido(seq), true);
});

check('aindaValido: uma sequência antiga fica inválida assim que uma nova começa', () => {
  const g = criarGuardiaoSequencia();
  const antiga = g.iniciar();
  g.iniciar(); // nova busca começou (ex.: usuário digitou mais um caractere)
  assert.equal(g.aindaValido(antiga), false);
});

check('cenário real: resposta da busca ANTIGA chega DEPOIS da busca NOVA — só a nova aplica', () => {
  const g = criarGuardiaoSequencia();
  const seqBuscaA = g.iniciar(); // usuário digitou "Rua Ita" — request lento em voo
  const seqBuscaB = g.iniciar(); // usuário completou "Rua Itajaí" — request rápido, chega primeiro

  // Resposta de B chega primeiro (rede rápida)
  assert.equal(g.aindaValido(seqBuscaB), true, 'resposta de B (mais nova) deve ser aplicada');

  // Resposta de A chega depois (rede lenta) — precisa ser descartada, senão sobrescreveria B
  assert.equal(g.aindaValido(seqBuscaA), false, 'resposta de A (mais antiga) deve ser descartada');
});

check('múltiplas buscas em sequência: só a última em voo é válida a qualquer momento', () => {
  const g = criarGuardiaoSequencia();
  const seqs = [g.iniciar(), g.iniciar(), g.iniciar(), g.iniciar()];
  seqs.forEach((seq, i) => {
    assert.equal(g.aindaValido(seq), i === seqs.length - 1);
  });
});

console.log(fail === 0
  ? '\nOK address-search-guard.golden — guarda de sequência da busca de endereço (sem rede)'
  : `\nFALHA address-search-guard.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
