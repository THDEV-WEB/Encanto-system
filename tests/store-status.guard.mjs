/* tests/store-status.guard.mjs — REF-BUSINESS-HOURS-02. Roda: node tests/store-status.guard.mjs
   GUARDA ESTRUTURAL da "fonte unica de verdade" do estado da loja. Falha se alguem reintroduzir logica
   de horario/status paralela. Analise estatica pura (sem banco/rede). Invariantes:
     (1) A decisao final (resolverOverride) e definida em UM unico arquivo (services/businessHours).
     (2) Ninguem no src extrai dia/hora com Date.getHours()/getDay() — o calculo de status passa SEMPRE
         pelo modulo (que usa Intl no fuso da loja). Qualquer getHours/getDay = regra de horario vazando.
     (3) O painel Admin (AdminStatus) CONSOME o estado compartilhado (useBusinessHours) e delega a
         escrita do modo ao servico (definirModo) — nao le/decide status por conta propria
         (sem localStorage direto, sem heuristica). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const files = readdirSync(SRC, { recursive: true }).map((f) => String(f).replace(/\\/g, '/')).filter((f) => /\.(js|jsx)$/.test(f)).sort();
const read = (f) => readFileSync(SRC + f, 'utf8');
/* remove comentarios p/ nao dar falso-positivo em texto explicativo */
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/* (1) resolverOverride definido em UM lugar so */
check('(1) resolverOverride e definido em exatamente 1 arquivo (services/businessHours)', () => {
  const defs = files.filter((f) => /export\s+function\s+resolverOverride\b/.test(strip(read(f))));
  assert.deepStrictEqual(defs, ['services/businessHours/businessHours.js'], `definicoes encontradas: ${JSON.stringify(defs)}`);
});

/* (2) ninguem usa getHours()/getDay() no src — status/horario so via o modulo (Intl) */
check('(2) nenhum getHours()/getDay() no src (calculo de horario nao vaza p/ componentes)', () => {
  const viol = files.filter((f) => /\.get(Hours|Day)\s*\(/.test(strip(read(f))));
  assert.deepStrictEqual(viol, [], `arquivos com getHours/getDay: ${JSON.stringify(viol)}`);
});

/* (3) AdminStatus consome o estado compartilhado e nao decide status sozinho */
check('(3) AdminStatus consome useBusinessHours e delega o modo a definirModo', () => {
  const code = strip(read('components/admin/AdminStatus.jsx'));
  assert.ok(/useBusinessHours/.test(code), 'AdminStatus deve consumir useBusinessHours (mesmo estado da loja)');
  assert.ok(/definirModo/.test(code), 'AdminStatus deve escrever o modo via definirModo (servico)');
  assert.ok(!/localStorage/.test(code), 'AdminStatus NAO deve tocar localStorage direto (delega ao override.js)');
  assert.ok(!/STORE_STATUS/.test(code), 'AdminStatus NAO deve ler STORE_STATUS direto (sem logica propria)');
});

console.log(fail === 0
  ? '\nOK store-status.guard — fonte unica preservada (resolverOverride unico, sem getHours/getDay, Admin consome o hook)'
  : `\nFALHA store-status.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
