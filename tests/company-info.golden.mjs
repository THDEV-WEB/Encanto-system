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

const CAMPOS_OBRIGATORIOS = ['nomeCurto', 'nomeCompleto', 'telefone', 'whatsapp', 'email', 'whatsappFloatEnabled', 'sobre', 'timezone', 'idioma', 'moeda'];
const CAMPOS_OPCIONAIS = ['instagram', 'facebook', 'tiktok', 'site', 'cardapio', 'googleMaps', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'estado', 'cnpj', 'razaoSocial', 'nomeFantasia'];

check('DEFAULT_COMPANY_INFO tem os 25 campos da Central de Configuração (REF-COMPANY-03) e os obrigatórios nunca vazios', () => {
  for (const k of [...CAMPOS_OBRIGATORIOS, ...CAMPOS_OPCIONAIS]) {
    assert.ok(k in DEFAULT_COMPANY_INFO, `campo ausente: ${k}`);
  }
  assert.equal(Object.keys(DEFAULT_COMPANY_INFO).length, 25);
  assert.equal(typeof DEFAULT_COMPANY_INFO.whatsappFloatEnabled, 'boolean');
  assert.ok(DEFAULT_COMPANY_INFO.sobre.length > 10);
  assert.equal(DEFAULT_COMPANY_INFO.timezone, 'America/Sao_Paulo');
});
check('DEFAULT_COMPANY_INFO: campos opcionais (redes sociais/endereço/institucional) começam vazios — nunca um placeholder fake', () => {
  for (const k of CAMPOS_OPCIONAIS) assert.equal(DEFAULT_COMPANY_INFO[k], '', `${k} deveria ser '' por padrão`);
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
check('nomeCurto valido (>=2 chars, trim) -> normalizado', () => {
  const r = validarPatchCompanyInfo({ nomeCurto: '  Encanto  ' });
  assert.equal(r.patch.nomeCurto, 'Encanto');
});
check('nomeCurto invalido (<2 chars) -> erro', () => {
  const r = validarPatchCompanyInfo({ nomeCurto: 'A' });
  assert.ok(r.erro);
});
check('nomeCompleto valido (>=2 chars, trim) -> normalizado', () => {
  const r = validarPatchCompanyInfo({ nomeCompleto: '  Encanto — Açaí & Marmitas  ' });
  assert.equal(r.patch.nomeCompleto, 'Encanto — Açaí & Marmitas');
});
check('nomeCompleto invalido (<2 chars) -> erro', () => {
  const r = validarPatchCompanyInfo({ nomeCompleto: 'A' });
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
check('sobre valido (>=10 chars, trim) -> normalizado (REF-COMPANY-03)', () => {
  const r = validarPatchCompanyInfo({ sobre: '  Texto de teste com parágrafos.\n\nSegundo parágrafo.  ' });
  assert.equal(r.patch.sobre, 'Texto de teste com parágrafos.\n\nSegundo parágrafo.');
});
check('sobre curto demais (<10 chars) -> erro', () => {
  const r = validarPatchCompanyInfo({ sobre: 'curto' });
  assert.ok(r.erro);
});
check('sobre vazio -> erro (nunca esvazia a tela "Sobre nós")', () => {
  const r = validarPatchCompanyInfo({ sobre: '   ' });
  assert.ok(r.erro);
});
check('sobre preserva quebras de linha SIMPLES internas (nao so parágrafos) — trim só nas pontas', () => {
  const r = validarPatchCompanyInfo({ sobre: '\n Linha 1\nLinha 2\n\nLinha 4 \n' });
  assert.equal(r.patch.sobre, 'Linha 1\nLinha 2\n\nLinha 4');
});

console.error('— Redes sociais (REF-COMPANY-03) — todas opcionais, URL quando preenchidas');

check('instagram/facebook/tiktok/site/cardapio/googleMaps vazios -> aceitos (ainda não configurado)', () => {
  const r = validarPatchCompanyInfo({ instagram: '', facebook: '', tiktok: '', site: '', cardapio: '', googleMaps: '' });
  assert.ok(!r.erro);
  assert.equal(r.patch.instagram, '');
});
check('instagram com URL válida -> normalizado (trim)', () => {
  const r = validarPatchCompanyInfo({ instagram: '  https://instagram.com/encanto  ' });
  assert.equal(r.patch.instagram, 'https://instagram.com/encanto');
});
check('site sem http(s):// -> erro (nunca salva link quebrado)', () => {
  const r = validarPatchCompanyInfo({ site: 'www.encanto.com.br' });
  assert.ok(r.erro);
});
check('googleMaps vazio depois de preenchido -> aceito (limpar o link é uma ação válida)', () => {
  const r = validarPatchCompanyInfo({ googleMaps: '   ' });
  assert.ok(!r.erro);
  assert.equal(r.patch.googleMaps, '');
});

console.error('— Endereço institucional (REF-COMPANY-03) — independente do endereço de retirada do checkout');

check('CEP com máscara -> normalizado para 8 dígitos', () => {
  const r = validarPatchCompanyInfo({ cep: '89120-000' });
  assert.equal(r.patch.cep, '89120000');
});
check('CEP com tamanho errado -> erro', () => {
  const r = validarPatchCompanyInfo({ cep: '123' });
  assert.ok(r.erro);
});
check('CEP vazio -> aceito (endereço institucional é opcional)', () => {
  const r = validarPatchCompanyInfo({ cep: '' });
  assert.ok(!r.erro);
});
check('estado (UF) minúsculo -> normalizado p/ maiúsculo', () => {
  const r = validarPatchCompanyInfo({ estado: 'sc' });
  assert.equal(r.patch.estado, 'SC');
});
check('estado (UF) com formato errado -> erro', () => {
  const r = validarPatchCompanyInfo({ estado: 'Santa Catarina' });
  assert.ok(r.erro);
});
check('rua/numero/bairro/cidade -> texto livre, só trim', () => {
  const r = validarPatchCompanyInfo({ rua: '  Rua Teste  ', numero: ' 123 ', bairro: ' Centro ', cidade: ' Timbó ' });
  assert.deepEqual({ rua: r.patch.rua, numero: r.patch.numero, bairro: r.patch.bairro, cidade: r.patch.cidade },
    { rua: 'Rua Teste', numero: '123', bairro: 'Centro', cidade: 'Timbó' });
});

console.error('— Informações institucionais e Configurações (REF-COMPANY-03)');

check('CNPJ com máscara -> normalizado para 14 dígitos', () => {
  const r = validarPatchCompanyInfo({ cnpj: '12.345.678/0001-90' });
  assert.equal(r.patch.cnpj, '12345678000190');
});
check('CNPJ com tamanho errado -> erro', () => {
  const r = validarPatchCompanyInfo({ cnpj: '123' });
  assert.ok(r.erro);
});
check('razaoSocial/nomeFantasia -> texto livre, opcional', () => {
  const r = validarPatchCompanyInfo({ razaoSocial: '  Encanto Ltda  ', nomeFantasia: '' });
  assert.equal(r.patch.razaoSocial, 'Encanto Ltda');
  assert.equal(r.patch.nomeFantasia, '');
});
check('timezone/idioma/moeda -> texto livre, sem validação de formato (preparo, sem efeito funcional)', () => {
  const r = validarPatchCompanyInfo({ timezone: ' America/Sao_Paulo ', idioma: ' pt-BR ', moeda: ' BRL ' });
  assert.deepEqual({ timezone: r.patch.timezone, idioma: r.patch.idioma, moeda: r.patch.moeda },
    { timezone: 'America/Sao_Paulo', idioma: 'pt-BR', moeda: 'BRL' });
});

console.log(fail === 0 ? '\nOK company-info.golden — defaults + formatacao + validacao de patch congelados' : `\nFALHA company-info.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
