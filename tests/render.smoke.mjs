/* tests/render.smoke.mjs — REF-APP-01 · R9 (rede de render). Roda com: node tests/render.smoke.mjs  (npm run test:render)
   Renderiza componentes-folha APRESENTACIONAIS via react-dom/server (renderToStaticMarkup), com props FIXAS,
   e compara o markup a um snapshot CONGELADO. JSX compilado por esbuild (loader _render-loader.mjs). Sem DOM,
   sem browser, sem rede, sem Supabase — node puro (mesmo estilo dos golden tests).

   PARA QUE SERVE: a partir da Onda 4, cada folha visual extraída do App.jsx entra aqui como 1 caso com o markup
   congelado NO MOMENTO DA EXTRAÇÃO (que, sendo move-puro, iguala o markup original). Qualquer drift de markup
   dessa folha em ondas futuras reprova o teste.

   ESCOPO (plano R9): SÓ folhas apresentacionais puras (sem hooks/DS/Supabase/browser). Orquestrador (StoreApp)
   e componentes browser-heavy (AddressModal, LazySection) NÃO entram aqui — seguem em smoke manual por onda.

   COMO ADICIONAR UMA FOLHA (Onda 4): importe o componente; adicione um caso { nome, el, snap:null }; rode uma vez
   (o teste imprime o markup atual do caso sem snapshot); cole esse markup em `snap`; rode de novo → verde. */
import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./_render-loader.mjs', import.meta.url);

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const h = React.createElement;

/* ── Componentes sob teste (import dinâmico, após register do loader) ── */
const AppShell       = (await import('../src/AppShell.jsx')).default;
const BackgroundLayer = (await import('../src/BackgroundLayer.jsx')).default;

/* ── Casos: props FIXAS + snapshot CONGELADO (Onda 4 acrescenta as folhas visuais AQUI) ── */
const CASES = [
  {
    nome: 'BackgroundLayer',
    el: () => h(BackgroundLayer),
    snap: '<div class="bg-layer" aria-hidden="true"></div>',
  },
  {
    nome: 'AppShell(children)',
    el: () => h(AppShell, null, h('span', null, 'X')),
    snap: '<div class="app-shell"><div class="bg-layer" aria-hidden="true"></div><div class="app-content-layer"><span>X</span></div></div>',
  },
];

let fail = 0;
for (const c of CASES) {
  const got = renderToStaticMarkup(c.el());
  if (c.snap == null) {
    fail++;
    console.error(`  ✗ ${c.nome} — SEM snapshot congelado. Markup atual (copie para \`snap\`):\n    ${got}`);
    continue;
  }
  try {
    assert.strictEqual(got, c.snap);
    console.error(`  ✓ ${c.nome}`);
  } catch {
    fail++;
    console.error(`  ✗ ${c.nome} — markup divergiu\n    esperado: ${c.snap}\n    obtido:   ${got}`);
  }
}
console.log(fail === 0 ? `\n✅ render.smoke OK — ${CASES.length} folha(s), markup estável` : `\n❌ ${fail} caso(s) divergente(s)/sem snapshot`);
process.exit(fail === 0 ? 0 : 1);
