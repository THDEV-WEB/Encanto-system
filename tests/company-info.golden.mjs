/* tests/company-info.golden.mjs — REF-COMPANY-01. Roda: node tests/company-info.golden.mjs
   GOLDEN dos dados institucionais da empresa. Congela as regras PURAS (companyInfoRules.js): defaults,
   formatacao de telefone p/ exibicao e validacao/normalizacao de patch. Sem banco/rede/React —
   importa companyInfoRules.js diretamente (NAO companyInfo.js, que importa lib/supabase.js/import.meta.env
   e quebraria em Node puro — mesmo cuidado de business-hours.golden.mjs com override.js). */
import assert from 'node:assert/strict';
import { DEFAULT_COMPANY_INFO, formatarTelefoneBR, validarPatchCompanyInfo } from '../src/services/company/companyInfoRules.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

console.error('— DEFAULT_COMPANY_INFO (fallback do modo degradado)');

check('DEFAULT_COMPANY_INFO tem os 5 campos v1 e nenhum vazio', () => {
  for (const k of ['nome', 'telefone', 'whatsapp', 'email', 'whatsappFloatEnabled']) {
    assert.ok(k in DEFAULT_COMPANY_INFO, `campo ausente: ${k}`);
  }
  assert.equal(typeof DEFAULT_COMPANY_INFO.whatsappFloatEnabled, 'boolean');
});

console.error('— formatarTelefoneBR (E.164 -> exibicao humana)');

check('E.164 com DDI 55 + celular (11 digitos locais) -> (DD) 9NNNN-NNNN', () => {
  assert.equal(formatarTelefoneBR('5547992722920'), '(47) 99272-2920');
});
check('E.164 com DDI 55 + fixo (10 digitos locais) -> (DD) NNNN-NNNN', () => {
  assert.equal(formatarTelefoneBR('554732722920'), '(47) 3272-2920');
});
check('sem DDI, 11 digitos -> formata direto (assume local)', () => {
  assert.equal(formatarTelefoneBR('47992722920'), '(47) 99272-2920');
});
check('vazio/nulo -> string vazia (nunca quebra)', () => {
  assert.equal(formatarTelefoneBR(''), '');
  assert.equal(formatarTelefoneBR(null), '');
});
check('lixo nao numerico -> devolve a entrada original (nao inventa formato)', () => {
  assert.equal(formatarTelefoneBR('abc'), 'abc');
});

console.error('— validarPatchCompanyInfo (client-side; servidor sempre revalida)');

check('patch vazio -> aceito sem alterar nada (equivalente a no-op)', () => {
  const r = validarPatchCompanyInfo({});
  assert.deepEqual(r.patch, {});
});
check('nome valido (>=2 chars, trim) -> normalizado', () => {
  const r = validarPatchCompanyInfo({ nome: '  Encanto  ' });
  assert.equal(r.patch.nome, 'Encanto');
});
check('nome invalido (<2 chars) -> erro', () => {
  const r = validarPatchCompanyInfo({ nome: 'A' });
  assert.ok(r.erro);
});
check('telefone/whatsapp com mascara -> normalizados para E.164 (mesmo normalizePhoneBR do projeto)', () => {
  const r = validarPatchCompanyInfo({ telefone: '(47) 99272-2920', whatsapp: '47 99272-2920' });
  assert.equal(r.patch.telefone, '5547992722920');
  assert.equal(r.patch.whatsapp, '5547992722920');
});
check('telefone curto demais -> erro', () => {
  const r = validarPatchCompanyInfo({ telefone: '123' });
  assert.ok(r.erro);
});
check('email valido (lowercase, trim) -> normalizado', () => {
  const r = validarPatchCompanyInfo({ email: '  Contato@Encanto.COM.br ' });
  assert.equal(r.patch.email, 'contato@encanto.com.br');
});
check('email invalido -> erro', () => {
  const r = validarPatchCompanyInfo({ email: 'nao-e-email' });
  assert.ok(r.erro);
});
check('whatsappFloatEnabled -> sempre vira booleano estrito', () => {
  assert.equal(validarPatchCompanyInfo({ whatsappFloatEnabled: 1 }).patch.whatsappFloatEnabled, true);
  assert.equal(validarPatchCompanyInfo({ whatsappFloatEnabled: 0 }).patch.whatsappFloatEnabled, false);
});
check('patch so com um campo -> so esse campo aparece no resultado (semantica de PATCH parcial)', () => {
  const r = validarPatchCompanyInfo({ whatsappFloatEnabled: false });
  assert.deepEqual(Object.keys(r.patch), ['whatsappFloatEnabled']);
});

console.log(fail === 0 ? '\nOK company-info.golden — defaults + formatacao + validacao de patch congelados' : `\nFALHA company-info.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
