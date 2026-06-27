/* tests/deps.audit.mjs — NORM-05.2 · roda com:  node tests/deps.audit.mjs  (npm run test:deps)
   AUDITORIA DE DEPENDÊNCIAS — prova mecânica de que os módulos de DOMÍNIO (pricing.js, addons.js)
   estão isolados do resto do sistema. Re-deriva o grafo de imports do src/ a cada execução e falha se:
   - um módulo de domínio deixar de ser FOLHA pura (passar a importar algo);
   - um módulo de domínio importar visual/app/React/CSS/Supabase ou o OUTRO domínio;
   - alguém além do App.jsx passar a importar um domínio (dependência invertida);
   - surgir um CICLO no grafo.
   Não toca o banco; análise estática pura. Imprime o grafo (quem importa quem). */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ✓ ' + m); } catch (e) { fail++; console.error('  ✗ ' + m + ' — ' + (e?.message ?? e)); } };

/* ── Coleta de arquivos + imports (specifiers), ignorando comentários ── */
const files = readdirSync(SRC, { recursive: true }).map(f => String(f).replace(/\\/g, '/')).filter(f => /\.(js|jsx)$/.test(f)).sort();
const importsOf = {};
for (const f of files) {
  const code = readFileSync(SRC + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  importsOf[f] = [...code.matchAll(/import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g)].map(m => m[1]);
}
const isRel = s => s.startsWith('.');
const resolveRel = (fromFile, spec) => posix.normalize(posix.join(posix.dirname(fromFile), spec));

const DOMAIN = ['utils/pricing.js', 'utils/addons.js'];

/* ── (A) domínio = FOLHA pura (zero imports) ── */
for (const d of DOMAIN)
  check(`${d} é FOLHA pura (zero imports)`, () => assert.deepStrictEqual(importsOf[d], [], `imports proibidos: ${JSON.stringify(importsOf[d])}`));

/* ── (B) domínio NÃO conhece o outro domínio ── */
for (const d of DOMAIN)
  check(`${d} não importa o outro domínio`, () => assert.ok(!importsOf[d].some(s => /pricing|addons/.test(s)), `cruzou domínios: ${importsOf[d]}`));

/* ── (C) domínio NÃO importa visual/app/React/CSS/Supabase ── */
const PROIBIDO = /react|jsx|\.css|AppShell|BackgroundLayer|App\.jsx|format|supabase|logo/i;
for (const d of DOMAIN)
  check(`${d} não importa visual/app/React/IO`, () => assert.ok(!importsOf[d].some(s => PROIBIDO.test(s)), `import proibido: ${importsOf[d]}`));

/* ── (D) dependência NÃO invertida: cada domínio é importado SÓ pelo App.jsx ── */
for (const d of DOMAIN) {
  const importers = files.filter(f => importsOf[f].some(s => isRel(s) && resolveRel(f, s) === d));
  check(`${d} importado só por App.jsx (sem dependência invertida)`, () => assert.deepStrictEqual(importers, ['App.jsx'], `importers: ${JSON.stringify(importers)}`));
}

/* ── (E) sem CICLOS (DFS sobre arestas relativas .js/.jsx) ── */
const edges = {};
for (const f of files) edges[f] = importsOf[f].filter(isRel).map(s => resolveRel(f, s)).filter(p => /\.(js|jsx)$/.test(p) && files.includes(p));
check('grafo ACÍCLICO (sem ciclos)', () => {
  const color = {}; files.forEach(f => color[f] = 0); let cyc = null;
  const dfs = (u, st) => { color[u] = 1; for (const v of edges[u]) { if (color[v] === 1) { cyc = [...st, u, v]; return true; } if (color[v] === 0 && dfs(v, [...st, u])) return true; } color[u] = 2; return false; };
  for (const f of files) if (color[f] === 0 && dfs(f, [])) break;
  assert.ok(!cyc, `ciclo: ${cyc?.join(' → ')}`);
});

/* ── (F) App.jsx CONSOME o domínio (direção correta) ── */
check('App.jsx consome pricing E addons (consumidor, não importado por eles)', () => {
  const a = importsOf['App.jsx'].map(s => isRel(s) ? resolveRel('App.jsx', s) : s);
  assert.ok(a.includes('utils/pricing.js') && a.includes('utils/addons.js'), 'App.jsx deveria consumir os dois domínios');
});

/* ── Grafo (relatório) ── */
console.error('\n— GRAFO DE DEPENDÊNCIAS (módulo → importa)');
for (const f of files) console.error(`  ${f}  →  ${edges[f].length ? edges[f].join(', ') : '(folha)'}`);
console.error('— QUEM IMPORTA O DOMÍNIO');
for (const d of DOMAIN) console.error(`  ${d}  ←  ${files.filter(f => edges[f].includes(d)).join(', ') || '(ninguém)'}`);

console.log(fail === 0 ? '\n✅ deps.audit OK — domínios isolados (folhas puras), sem ciclos, sem dependência invertida' : `\n❌ ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
