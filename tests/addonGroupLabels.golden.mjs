/* tests/addonGroupLabels.golden.mjs — REF-REGRESSION-01 · P6.
   node tests/addonGroupLabels.golden.mjs (npm run test:addon-labels)
   Congela utils/addonGroupLabels.js — a fonte ÚNICA de emoji/nome por grupo de adicional, extraída
   para fechar o achado real da auditoria: 3 componentes (AdminAdicionais/AdminProducts/
   ProductModalInner) mantinham cada um sua própria cópia do mapa grupo→emoji/nome; a de
   AdminAdicionais só reconhecia 3 dos 7 grupos reais, fazendo simples/premium/frutas_premium/
   chocolates colapsarem todos em "🍇 Açaí" — a causa raiz da falsa percepção de "adicionais
   duplicados" no Admin (Amendoim/acai e Amendoim/simples pareciam a mesma linha 2x).
   Prova com os NOMES REAIS do catálogo (Amendoim, Coloretti) que apareceram no relato do dono. */
import assert from 'node:assert/strict';
import { GRUPO_INFO, grupoLabel } from '../src/utils/addonGroupLabels.js';
import { GRUPOS } from '../src/utils/addons.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

check('GRUPO_INFO cobre os 7 grupos reais de GRUPOS (nenhum órfão, nenhum faltando)', () => {
  assert.deepEqual(Object.keys(GRUPO_INFO).sort(), Object.values(GRUPOS).sort());
});

check('cada grupo tem emoji + nome não-vazios', () => {
  for (const g of Object.values(GRUPOS)) {
    assert.ok(GRUPO_INFO[g].emoji, `grupo "${g}" sem emoji`);
    assert.ok(GRUPO_INFO[g].nome, `grupo "${g}" sem nome`);
  }
});

check('grupoLabel: os 7 grupos produzem 7 rótulos DISTINTOS entre si (nunca colapsam)', () => {
  const rotulos = Object.values(GRUPOS).map(grupoLabel);
  assert.equal(new Set(rotulos).size, 7, `rótulos colidiram: ${JSON.stringify(rotulos)}`);
});

/* Caso real relatado pelo dono: "Amendoim" (grupo acai) e "Amendoim" (grupo simples) pareciam a
   MESMA linha na listagem do Admin — a causa era o badge, não o dado (2 linhas físicas distintas,
   ambas usadas por produtos diferentes — ver docs/ref/REF-REGRESSION-01-progress.md). */
check('achado real: Amendoim(acai) e Amendoim(simples) -> badges diferentes', () => {
  assert.equal(grupoLabel(GRUPOS.ACAI), '🍇 Açaí');
  assert.equal(grupoLabel(GRUPOS.SIMPLES), '🥄 Simples');
  assert.notEqual(grupoLabel(GRUPOS.ACAI), grupoLabel(GRUPOS.SIMPLES));
});
check('achado real: Coloretti(acai) e Coloretti(chocolates) -> badges diferentes', () => {
  assert.equal(grupoLabel(GRUPOS.ACAI), '🍇 Açaí');
  assert.equal(grupoLabel(GRUPOS.CHOCOLATES), '🍫 Chocolates');
  assert.notEqual(grupoLabel(GRUPOS.ACAI), grupoLabel(GRUPOS.CHOCOLATES));
});

check('grupo desconhecido (futuro) nunca quebra — devolve o texto cru capitalizado', () => {
  assert.equal(grupoLabel('molhos_especiais'), 'Molhos Especiais');
  assert.equal(grupoLabel(''), '');
  assert.equal(grupoLabel(undefined), '');
});

console.log(fail === 0
  ? '\nOK addonGroupLabels.golden — fonte única de emoji/nome por grupo estável, 7 grupos sem colisão'
  : `\nFALHA addonGroupLabels.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
