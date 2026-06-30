/* tests/deps.audit.mjs — NORM-05.2 · roda com:  node tests/deps.audit.mjs  (npm run test:deps)
   AUDITORIA DE DEPENDÊNCIAS — prova mecânica de que os módulos de DOMÍNIO (pricing.js, addons.js)
   estão isolados do resto do sistema. Re-deriva o grafo de imports do src/ a cada execução e falha se:
   - um módulo de domínio deixar de ser FOLHA pura (passar a importar algo);
   - um módulo de domínio importar visual/app/React/CSS/Supabase ou o OUTRO domínio;
   - um consumidor FORA da allowlist evolutiva importar um domínio (D1), ou uma camada de
     dados/serviço/infra (services/lib/data/constants) importar lógica pura/domínio (D2 estrutural);
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

/* ── (D) governança de consumidores do domínio — compatível com modularização incremental (REF-APP-01 · Onda 0) ──
   Substitui a igualdade rígida `importers === ['App.jsx']` (que inviabilizava extrair componentes do monólito).
   D1 (allowlist evolutiva): importers de domínio ⊆ DOMAIN_CONSUMERS — cresce commit-a-commit (cada extração que
       passe a importar um domínio adiciona a si mesma à lista NO MESMO commit).
   D2 (estrutural por camada): camadas de dados/serviço/infra (services/lib/data/constants) NÃO importam lógica
       pura/domínio (pricing/addons/format); só UI/presentation (components/pages/hooks/App) pode consumi-la.
   D3 (higiene): allowlist sem entrada morta (nenhum consumidor listado que ainda não importe um domínio).
   A prova de "domínio = folha pura, fora de ciclo, direção correta" permanece em A/B/C/E/F (inalteradas). */
const DOMAIN_CONSUMERS = [
  'App.jsx',                 // raiz (regra F) — único consumidor atual
  // Cada extração que importe pricing/addons adiciona a si mesma AQUI, no MESMO commit. Ex. (REF-APP-01):
  // 'pages/StoreApp.jsx', 'hooks/useCart.js', 'hooks/useAdicionais.js', 'components/ProductCard.jsx',
  // 'components/ProductModal/ProductModalInner.jsx', 'components/CartSidebar.jsx',
  // 'components/checkout/CheckoutPage.jsx', 'components/admin/AdminProducts.jsx', 'components/admin/AdminAdicionais.jsx',
];
const PURE_LOGIC = ['utils/pricing.js', 'utils/addons.js', 'utils/format.js']; // núcleo de lógica pura protegido por D2 (extensível)
const NON_UI_LAYER = /^(services|lib|data|constants)\//;                        // camadas fora de UI/presentation

/* (D1) sem consumidor-surpresa: todo importer de domínio está na allowlist evolutiva */
for (const d of DOMAIN) {
  const importers = files.filter(f => importsOf[f].some(s => isRel(s) && resolveRel(f, s) === d));
  check(`(D1) ${d}: importers ⊆ allowlist (sem consumidor-surpresa)`, () => {
    const fora = importers.filter(f => !DOMAIN_CONSUMERS.includes(f));
    assert.deepStrictEqual(fora, [], `consumidores não autorizados: ${JSON.stringify(fora)}`);
  });
}
/* (D2) estrutural: nenhuma camada fora de UI/presentation importa lógica pura/domínio */
check('(D2) camadas services/lib/data/constants NÃO importam lógica pura (pricing/addons/format)', () => {
  const violacoes = files.filter(f => NON_UI_LAYER.test(f))
    .flatMap(f => importsOf[f].filter(s => isRel(s) && PURE_LOGIC.includes(resolveRel(f, s))).map(s => `${f} → ${resolveRel(f, s)}`));
  assert.deepStrictEqual(violacoes, [], `imports proibidos de lógica pura por camada não-UI: ${JSON.stringify(violacoes)}`);
});
/* (D3) higiene: allowlist sem entrada morta */
check('(D3) allowlist de consumidores sem entrada morta', () => {
  const todos = new Set(DOMAIN.flatMap(d => files.filter(f => importsOf[f].some(s => isRel(s) && resolveRel(f, s) === d))));
  const mortas = DOMAIN_CONSUMERS.filter(c => !todos.has(c));
  assert.deepStrictEqual(mortas, [], `entradas mortas na allowlist: ${JSON.stringify(mortas)}`);
});

/* ── (INV-CK) invariante estrutural do domínio de checkout (REF-APP-01) — elimina duplicação por REGRA ──
   order-domain (utils/orderPayload.js) = FONTE ÚNICA de cálculo/formatação/derivação do pedido.
   Guards estruturais-inertes (vazios até os módulos existirem; ativam na extração do checkout):
   - G-CK1 (=D2 acima): DataService/services não importam pricing/addons/format → não reimplementam o domínio. JÁ ATIVO.
   - G-CK2 (I-CK2): components/checkout/** (o submit) NÃO importa pricing/addons/format direto — só o order-domain.
   - G-CK3 (I-CK1): order-domain é PURO — sem React/IO/DataService/hooks (pode compor pricing/addons/format). */
const CHECKOUT_LAYER = /^components\/checkout\//;
const ORDER_DOMAIN   = ['utils/orderPayload.js'];                                   // extensível
const ORDER_DOMAIN_IO = /react|jsx|\.css|supabase|DataService|services\/|hooks\/|AppShell|BackgroundLayer|App\.jsx|logo/i;
check('(G-CK2·INV-CK) components/checkout NÃO importa pricing/addons/format direto (usa o order-domain) [vazio até extrair]', () => {
  const viol = files.filter(f => CHECKOUT_LAYER.test(f))
    .flatMap(f => importsOf[f].filter(s => isRel(s) && PURE_LOGIC.includes(resolveRel(f, s))).map(s => `${f} → ${resolveRel(f, s)}`));
  assert.deepStrictEqual(viol, [], `checkout importou lógica pura direto (I-CK2): ${JSON.stringify(viol)}`);
});
check('(G-CK3·INV-CK) order-domain (utils/orderPayload) é PURO — sem React/IO/DataService [vazio até existir]', () => {
  const viol = ORDER_DOMAIN.filter(m => files.includes(m))
    .flatMap(m => importsOf[m].filter(s => ORDER_DOMAIN_IO.test(s)).map(s => `${m} → ${s}`));
  assert.deepStrictEqual(viol, [], `order-domain importou React/IO (I-CK1): ${JSON.stringify(viol)}`);
});

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
