/* tests/company-info.golden.mjs — REF-COMPANY-01. Roda: node tests/company-info.golden.mjs
   GOLDEN dos dados institucionais da empresa. Congela as regras PURAS (companyInfoRules.js): defaults,
   formatacao de telefone p/ exibicao e validacao/normalizacao de patch. Sem banco/rede/React —
   importa companyInfoRules.js diretamente (NAO companyInfo.js, que importa lib/supabase.js/import.meta.env
   e quebraria em Node puro — mesmo cuidado de business-hours.golden.mjs com override.js). */
import assert from 'node:assert/strict';
import { DEFAULT_COMPANY_INFO, formatarTelefoneBR, validarPatchCompanyInfo, localizacaoLojaConfigurada } from '../src/services/company/companyInfoRules.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

console.error('— DEFAULT_COMPANY_INFO (fallback do modo degradado)');

const CAMPOS_OBRIGATORIOS = ['nomeCurto', 'nomeCompleto', 'sobre', 'timezone', 'idioma', 'moeda'];
const CAMPOS_IDENTIDADE_CONTATO = ['telefone', 'whatsapp', 'email']; // REF-SAAS-01 Onda 7.1 — vazios por padrão (nunca dado real de outra loja)
const CAMPOS_OPCIONAIS = ['instagram', 'facebook', 'tiktok', 'site', 'cardapio', 'googleMaps', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'estado', 'cnpj', 'razaoSocial', 'nomeFantasia'];
const CAMPOS_COORDENADAS = ['lojaLat', 'lojaLng']; // REF-DELIVERY-FEE-01 — localização operacional da loja (null até o pino ser posicionado)
const CAMPOS_BRANDING_URL = ['logoUrl', 'faviconUrl', 'bannerUrl']; // REF-SAAS-01 Onda 6.2 (+REF-SAAS-02 Onda 2: bannerUrl) — null até o admin subir uma imagem
const CAMPOS_BRANDING_COR = ['corPrimaria', 'corSecundaria', 'corDestaque']; // REF-SAAS-01 Onda 6.2 — hex #RRGGBB, nunca vazio
const CAMPOS_BRANDING_CONTEUDO = ['termosSecoes', 'fidelidadeTexto']; // REF-SAAS-01 Onda 6.2 — arrays, aposentam constants/storeInfo.js
const CAMPOS_BRANDING_LAYOUT = ['logoPreset']; // REF-SAAS-02 Onda 2 — como a logo é apresentada ('organico' default/Encanto, ou 'retangular')

check('DEFAULT_COMPANY_INFO tem os 36 campos da Central de Configuração (REF-COMPANY-03 + REF-DELIVERY-FEE-01 + REF-SAAS-01 Onda 6.2 + REF-SAAS-02 Onda 2) e os obrigatórios (identidade genérica/conteúdo institucional) nunca vazios', () => {
  for (const k of [...CAMPOS_OBRIGATORIOS, ...CAMPOS_IDENTIDADE_CONTATO, ...CAMPOS_OPCIONAIS, ...CAMPOS_COORDENADAS, ...CAMPOS_BRANDING_URL, ...CAMPOS_BRANDING_COR, ...CAMPOS_BRANDING_CONTEUDO, ...CAMPOS_BRANDING_LAYOUT]) {
    assert.ok(k in DEFAULT_COMPANY_INFO, `campo ausente: ${k}`);
  }
  assert.equal(Object.keys(DEFAULT_COMPANY_INFO).length, 36);
  assert.ok(DEFAULT_COMPANY_INFO.sobre.length > 10);
  assert.equal(DEFAULT_COMPANY_INFO.timezone, 'America/Sao_Paulo');
  // REF-SAAS-01 Onda 7.1: nomeCurto/nomeCompleto são um placeholder GENÉRICO ("Loja"), nunca a
  // identidade real de nenhuma loja específica (bundle único multi-tenant — ver cabeçalho do arquivo).
  assert.equal(DEFAULT_COMPANY_INFO.nomeCurto, 'Loja');
  assert.equal(DEFAULT_COMPANY_INFO.nomeCompleto, 'Loja');
  // REF-SAAS-02 · Onda 2 (bug real achado em teste E2E): a Encanto nunca teve `sobre` persistido em
  // store_settings — este texto ERA sempre o "Sobre nós" real dela, vazando pra qualquer loja nova sem
  // sobre próprio. A Encanto ganhou o mesmo texto explícito no banco (dado operacional); este default
  // precisa ser genérico igual nomeCurto/telefone/whatsapp/email — nunca a marca/copy real de nenhuma
  // loja específica.
  assert.doesNotMatch(DEFAULT_COMPANY_INFO.sobre.toLowerCase(), /encanto|açaí|acai|marmita|timbó|timbo/);
});
check('DEFAULT_COMPANY_INFO (REF-SAAS-01 Onda 7.1): telefone/whatsapp/email começam vazios e whatsappFloatEnabled começa false — nunca o contato real de outra loja', () => {
  for (const k of CAMPOS_IDENTIDADE_CONTATO) assert.equal(DEFAULT_COMPANY_INFO[k], '', `${k} deveria ser '' por padrão`);
  assert.equal(DEFAULT_COMPANY_INFO.whatsappFloatEnabled, false);
});
check('DEFAULT_COMPANY_INFO: campos opcionais (redes sociais/endereço/institucional) começam vazios — nunca um placeholder fake', () => {
  for (const k of CAMPOS_OPCIONAIS) assert.equal(DEFAULT_COMPANY_INFO[k], '', `${k} deveria ser '' por padrão`);
});
check('DEFAULT_COMPANY_INFO: coordenadas da loja começam null — nunca um pino falso no mapa', () => {
  for (const k of CAMPOS_COORDENADAS) assert.equal(DEFAULT_COMPANY_INFO[k], null, `${k} deveria ser null por padrão`);
});
check('DEFAULT_COMPANY_INFO (REF-SAAS-01 Onda 6.2 + REF-SAAS-02 Onda 2): logoUrl/faviconUrl/bannerUrl começam null (asset estático/fundo neutro são o fallback)', () => {
  for (const k of CAMPOS_BRANDING_URL) assert.equal(DEFAULT_COMPANY_INFO[k], null, `${k} deveria ser null por padrão`);
});
check("DEFAULT_COMPANY_INFO (REF-SAAS-02 Onda 2): logoPreset começa 'organico' (comportamento visual de hoje, byte-idêntico pra Encanto)", () => {
  assert.equal(DEFAULT_COMPANY_INFO.logoPreset, 'organico');
});
check('DEFAULT_COMPANY_INFO (REF-SAAS-01 Onda 6.2): paleta de cores começa com hex válido #RRGGBB (nunca vazia)', () => {
  for (const k of CAMPOS_BRANDING_COR) assert.match(DEFAULT_COMPANY_INFO[k], /^#[0-9A-Fa-f]{6}$/, `${k} deveria ser um hex #RRGGBB`);
});
check('DEFAULT_COMPANY_INFO (REF-SAAS-01 Onda 6.2): termosSecoes/fidelidadeTexto começam com o conteúdo hoje hardcoded (byte-idêntico, zero mudança visual)', () => {
  assert.ok(Array.isArray(DEFAULT_COMPANY_INFO.termosSecoes) && DEFAULT_COMPANY_INFO.termosSecoes.length >= 1);
  for (const s of DEFAULT_COMPANY_INFO.termosSecoes) { assert.ok(s.titulo); assert.ok(s.corpo); }
  assert.ok(Array.isArray(DEFAULT_COMPANY_INFO.fidelidadeTexto) && DEFAULT_COMPANY_INFO.fidelidadeTexto.length >= 1);
  for (const p of DEFAULT_COMPANY_INFO.fidelidadeTexto) assert.ok(typeof p === 'string' && p.length > 0);
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
check('REF-SAAS-02 Onda 2 (bug real corrigido): telefone/whatsapp vazio -> aceito (estado "ainda não configurado", nunca erro)', () => {
  const r = validarPatchCompanyInfo({ telefone: '', whatsapp: '' });
  assert.ok(!r.erro);
  assert.equal(r.patch.telefone, '');
  assert.equal(r.patch.whatsapp, '');
});
check('email valido (lowercase, trim) -> normalizado', () => {
  const r = validarPatchCompanyInfo({ email: '  Contato@Encanto.COM.br ' });
  assert.equal(r.patch.email, 'contato@encanto.com.br');
});
check('email invalido -> erro', () => {
  const r = validarPatchCompanyInfo({ email: 'nao-e-email' });
  assert.ok(r.erro);
});
check('REF-SAAS-02 Onda 2 (bug real corrigido): email vazio -> aceito (estado "ainda não configurado", não mais erro)', () => {
  const r = validarPatchCompanyInfo({ email: '' });
  assert.ok(!r.erro);
  assert.equal(r.patch.email, '');
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

console.error('— Localização operacional da loja (REF-DELIVERY-FEE-01)');

check('lojaLat/lojaLng válidos -> normalizados para Number', () => {
  const r = validarPatchCompanyInfo({ lojaLat: '-26.795', lojaLng: '-49.270' });
  assert.deepEqual({ lojaLat: r.patch.lojaLat, lojaLng: r.patch.lojaLng }, { lojaLat: -26.795, lojaLng: -49.270 });
});
check('lojaLat fora do intervalo global (-90..90) -> erro', () => {
  const r = validarPatchCompanyInfo({ lojaLat: 200 });
  assert.ok(r.erro);
});
check('lojaLng fora do intervalo global (-180..180) -> erro', () => {
  const r = validarPatchCompanyInfo({ lojaLng: -200 });
  assert.ok(r.erro);
});
check('lojaLat/lojaLng null -> aceito (limpar o pino é uma ação válida)', () => {
  const r = validarPatchCompanyInfo({ lojaLat: null, lojaLng: null });
  assert.deepEqual({ lojaLat: r.patch.lojaLat, lojaLng: r.patch.lojaLng }, { lojaLat: null, lojaLng: null });
});
check('lojaLat não numérico -> erro (nunca salva lixo)', () => {
  const r = validarPatchCompanyInfo({ lojaLat: 'abc' });
  assert.ok(r.erro);
});

console.error('— localizacaoLojaConfigurada (REF-DELIVERY-FEE-02) — fonte única "loja tem posição definida?"');

check('empresa SEM coordenadas (default de fábrica: null/null) -> false', () => {
  assert.equal(localizacaoLojaConfigurada(DEFAULT_COMPANY_INFO), false);
});
check('empresa COM coordenadas válidas (lat e lng finitos) -> true', () => {
  assert.equal(localizacaoLojaConfigurada({ ...DEFAULT_COMPANY_INFO, lojaLat: -26.795, lojaLng: -49.270 }), true);
});
check('coordenada 0,0 (litoral da África, mas um número finito válido) -> true — 0 nunca é confundido com "ausente"', () => {
  assert.equal(localizacaoLojaConfigurada({ ...DEFAULT_COMPANY_INFO, lojaLat: 0, lojaLng: 0 }), true);
});
check('só lat definida, lng ainda null (estado impossível pela UI, mas defendido) -> false', () => {
  assert.equal(localizacaoLojaConfigurada({ ...DEFAULT_COMPANY_INFO, lojaLat: -26.795, lojaLng: null }), false);
});
check('só lng definida, lat ainda null -> false', () => {
  assert.equal(localizacaoLojaConfigurada({ ...DEFAULT_COMPANY_INFO, lojaLat: null, lojaLng: -49.270 }), false);
});
check('coordenadas não numéricas/NaN (defesa contra dado corrompido vindo do servidor) -> false, nunca lança', () => {
  assert.equal(localizacaoLojaConfigurada({ lojaLat: NaN, lojaLng: -49.270 }), false);
  assert.equal(localizacaoLojaConfigurada({ lojaLat: 'abc', lojaLng: -49.270 }), false);
});
check('info ausente/undefined -> false, nunca lança (guarda de entrada)', () => {
  assert.equal(localizacaoLojaConfigurada(undefined), false);
  assert.equal(localizacaoLojaConfigurada(null), false);
});

console.error('— Branding por loja (REF-SAAS-01 · Onda 6.2)');

check('logoUrl/faviconUrl válidos (URL http(s)) -> aceitos', () => {
  const r = validarPatchCompanyInfo({ logoUrl: 'https://cdn.exemplo.com/logo.png', faviconUrl: 'https://cdn.exemplo.com/favicon.png' });
  assert.ok(!r.erro);
  assert.equal(r.patch.logoUrl, 'https://cdn.exemplo.com/logo.png');
});
check('logoUrl/faviconUrl vazio/null -> normalizado para null (usa o asset estático)', () => {
  const r = validarPatchCompanyInfo({ logoUrl: '', faviconUrl: null });
  assert.ok(!r.erro);
  assert.equal(r.patch.logoUrl, null);
  assert.equal(r.patch.faviconUrl, null);
});
check('logoUrl sem http(s) -> erro (nunca salva link quebrado)', () => {
  const r = validarPatchCompanyInfo({ logoUrl: 'ftp://exemplo.com/logo.png' });
  assert.ok(r.erro);
});
check('REF-SAAS-02 Onda 2: bannerUrl válido (URL http(s)) -> aceito; vazio/null -> normalizado para null', () => {
  const r1 = validarPatchCompanyInfo({ bannerUrl: 'https://cdn.exemplo.com/banner.jpg' });
  assert.ok(!r1.erro);
  assert.equal(r1.patch.bannerUrl, 'https://cdn.exemplo.com/banner.jpg');
  const r2 = validarPatchCompanyInfo({ bannerUrl: '' });
  assert.ok(!r2.erro);
  assert.equal(r2.patch.bannerUrl, null);
});
check('REF-SAAS-02 Onda 2: bannerUrl sem http(s) -> erro (nunca salva link quebrado)', () => {
  assert.ok(validarPatchCompanyInfo({ bannerUrl: 'ftp://exemplo.com/banner.jpg' }).erro);
});
check("REF-SAAS-02 Onda 2: logoPreset aceita só 'organico'/'retangular'", () => {
  assert.ok(!validarPatchCompanyInfo({ logoPreset: 'organico' }).erro);
  assert.ok(!validarPatchCompanyInfo({ logoPreset: 'retangular' }).erro);
  assert.ok(validarPatchCompanyInfo({ logoPreset: 'quadrado' }).erro);
});
check('corPrimaria/corSecundaria/corDestaque em hex válido -> aceitos', () => {
  const r = validarPatchCompanyInfo({ corPrimaria: '#112233', corSecundaria: '#AABBCC', corDestaque: '#ffbf00' });
  assert.deepEqual({ p: r.patch.corPrimaria, s: r.patch.corSecundaria, d: r.patch.corDestaque },
    { p: '#112233', s: '#AABBCC', d: '#ffbf00' });
});
check('cor fora do formato #RRGGBB -> erro', () => {
  assert.ok(validarPatchCompanyInfo({ corPrimaria: 'roxo' }).erro);
  assert.ok(validarPatchCompanyInfo({ corPrimaria: '#12345' }).erro);
});
check('termosSecoes válido (array de {titulo,corpo}) -> normalizado (trim)', () => {
  const r = validarPatchCompanyInfo({ termosSecoes: [{ titulo: '  Uso  ', corpo: '  Texto de teste.  ' }] });
  assert.deepEqual(r.patch.termosSecoes, [{ titulo: 'Uso', corpo: 'Texto de teste.' }]);
});
check('termosSecoes com seção sem título/corpo -> erro', () => {
  assert.ok(validarPatchCompanyInfo({ termosSecoes: [{ titulo: '', corpo: 'x' }] }).erro);
  assert.ok(validarPatchCompanyInfo({ termosSecoes: [{ titulo: 'x', corpo: '' }] }).erro);
});
check('termosSecoes vazio -> aceito (admin removeu todas as seções deliberadamente)', () => {
  const r = validarPatchCompanyInfo({ termosSecoes: [] });
  assert.ok(!r.erro);
  assert.deepEqual(r.patch.termosSecoes, []);
});
check('fidelidadeTexto válido (array de strings) -> normalizado (trim)', () => {
  const r = validarPatchCompanyInfo({ fidelidadeTexto: ['  Parágrafo 1.  ', 'Parágrafo 2.'] });
  assert.deepEqual(r.patch.fidelidadeTexto, ['Parágrafo 1.', 'Parágrafo 2.']);
});
check('fidelidadeTexto com parágrafo vazio -> erro', () => {
  assert.ok(validarPatchCompanyInfo({ fidelidadeTexto: ['ok', '   '] }).erro);
});
check('termosSecoes/fidelidadeTexto que não são array -> erro (nunca salva formato inesperado)', () => {
  assert.ok(validarPatchCompanyInfo({ termosSecoes: 'não é array' }).erro);
  assert.ok(validarPatchCompanyInfo({ fidelidadeTexto: { a: 1 } }).erro);
});

console.log(fail === 0 ? '\nOK company-info.golden — defaults + formatacao + validacao de patch congelados' : `\nFALHA company-info.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
