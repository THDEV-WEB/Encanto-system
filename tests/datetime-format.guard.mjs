/* tests/datetime-format.guard.mjs — REF-DATETIME-01. Roda: node tests/datetime-format.guard.mjs
   GUARDA ESTRUTURAL: utils/format.js e a UNICA fonte de formatacao de data/hora do app (fmtDataHoraLoja/
   dataLojaYMD). Falha se `.toLocaleString(`/`.toLocaleDateString(` reaparecer em QUALQUER outro arquivo
   de src/ — a causa raiz da auditoria REF-DATETIME-01 foi exatamente isso: cada tela formatando data por
   conta propria (o antigo fmtDate, sem fixar timeZone, "funcionava por coincidencia" so pra quem estava
   no fuso da loja). Analise estatica pura (sem banco/rede). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const files = readdirSync(SRC, { recursive: true }).map(f => String(f).replace(/\\/g, '/')).filter(f => /\.(js|jsx)$/.test(f)).sort();
const ALVO = /\.toLocaleString\(|\.toLocaleDateString\(/;
const ISENTO = 'utils/format.js'; // unica fonte de verdade — e onde a regra VIVE

check('so utils/format.js chama .toLocaleString/.toLocaleDateString em src/', () => {
  const violacoes = files
    .filter(f => f !== ISENTO)
    .flatMap(f => {
      const code = readFileSync(SRC + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      return ALVO.test(code) ? [f] : [];
    });
  assert.deepStrictEqual(violacoes, [], `formatacao de data ad hoc reapareceu fora de ${ISENTO}: ${JSON.stringify(violacoes)}`);
});

check('utils/format.js continua sendo a fonte (usa .toLocaleString/.toLocaleDateString)', () => {
  const code = readFileSync(SRC + ISENTO, 'utf8');
  assert.ok(ALVO.test(code), `${ISENTO} deveria conter a formatacao — guard ficaria vazio de significado se nao`);
});

console.log(fail === 0
  ? '\nOK datetime-format.guard — formatacao de data/hora concentrada em utils/format.js'
  : `\nFALHA datetime-format.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
