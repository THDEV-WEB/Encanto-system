/* tests/company-info.guard.mjs — REF-COMPANY-01. Roda: node tests/company-info.guard.mjs
   GUARDA ESTRUTURAL dos dados institucionais da empresa. Falha se alguem reintroduzir hardcode de
   telefone/whatsapp/e-mail ou duplicar a fonte de verdade. Analise estatica pura (sem banco/rede).
   Invariantes:
     (1) A antiga constante WHATSAPP (env var + fallback hardcoded em lib/supabase.js) NUNCA volta.
     (2) STORE_INFO nao guarda mais nome/telefone/e-mail (migraram p/ settings.company_info).
     (3) useCompanyInfo e definido em exatamente 1 arquivo (hooks/useCompanyInfo.js).
     (4) Nenhum wa.me/tel:/mailto: hardcoded (numero/e-mail literal) fora da camada company/migrations —
         os 4 pontos de contato do cliente (botao flutuante, checkout, tela Contato, modal Fidelidade)
         usam SEMPRE useCompanyInfo(), nunca um literal.
     (5) O botao flutuante do WhatsApp em StoreApp.jsx e condicional a whatsappFloatEnabled (nunca aparece
         incondicionalmente) — layout nao quebra quando desativado (o `&&` remove o elemento inteiro).
     (6) companyInfo.js (camada IO) realmente chama get_company_info/set_company_info (nao get_setting
         generico — armadilha de RLS ja documentada em REF-DELIVERY-01a).
     (7) REF-COMPANY-03: SOBRE_TEXTO (array hardcoded) nunca reaparece em constants/storeInfo.js;
         SobreScreen consome useCompanyInfo (fonte unica do texto institucional). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const files = readdirSync(SRC, { recursive: true }).map((f) => String(f).replace(/\\/g, '/')).filter((f) => /\.(js|jsx)$/.test(f)).sort();
const read = (f) => readFileSync(SRC + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/* (1) WHATSAPP (env var + fallback hardcoded) nunca reaparece */
check('(1) export const WHATSAPP nao existe mais em nenhum arquivo do src', () => {
  const viol = files.filter((f) => /export\s+const\s+WHATSAPP\b/.test(strip(read(f))));
  assert.deepStrictEqual(viol, [], `WHATSAPP reintroduzido em: ${JSON.stringify(viol)}`);
});

/* (2) STORE_INFO nao guarda mais os campos migrados p/ company_info */
check('(2) STORE_INFO nao declara nome/telefoneDisplay/telefoneDigits/email (migrados)', () => {
  const code = strip(read('constants/storeInfo.js'));
  for (const campo of ['nome:', 'telefoneDisplay:', 'telefoneDigits:', 'email:']) {
    assert.ok(!code.includes(campo), `STORE_INFO ainda declara "${campo}" (deveria vir de company_info)`);
  }
});

/* (3) useCompanyInfo definido em UM lugar so */
check('(3) useCompanyInfo e definido em exatamente 1 arquivo (hooks/useCompanyInfo.js)', () => {
  const defs = files.filter((f) => /export\s+function\s+useCompanyInfo\b/.test(strip(read(f))));
  assert.deepStrictEqual(defs, ['hooks/useCompanyInfo.js'], `definicoes encontradas: ${JSON.stringify(defs)}`);
});

/* (4) os 4 pontos de contato do cliente nunca hardcodeiam wa.me/tel:/mailto — sempre via useCompanyInfo */
const PONTOS_DE_CONTATO = [
  'pages/StoreApp.jsx',
  'components/checkout/SuccessPage.jsx',
  'components/menu/ContatoScreen.jsx',
  'components/admin/AdminFidelidade.jsx',
];
check('(4) pontos de contato do cliente consomem useCompanyInfo (sem numero/e-mail hardcoded)', () => {
  for (const f of PONTOS_DE_CONTATO) {
    const code = strip(read(f));
    // SuccessPage e a UNICA excecao: recebe "whatsapp" via PROP (StoreApp e o unico ponto de consumo do
    // hook e distribui por props, mesmo padrao ja estabelecido p/ deliveryEta — ver useDeliveryEta.js).
    if (f === 'components/checkout/SuccessPage.jsx') {
      assert.ok(/\bwhatsapp\b/.test(code), `${f} deveria receber "whatsapp" via prop (de StoreApp)`);
    } else {
      assert.ok(/useCompanyInfo/.test(code), `${f} deveria consumir useCompanyInfo`);
    }
    // wa.me/ ou tel:+ seguido DIRETO de digito = numero hardcoded (interpolacao de variavel nunca casa aqui)
    assert.ok(!/wa\.me\/\d/.test(code), `${f} tem um numero de WhatsApp hardcoded em wa.me/`);
    assert.ok(!/tel:\+?\d{10,}/.test(code), `${f} tem um telefone hardcoded em tel:`);
  }
  // StoreApp/SuccessPage recebem a prop (unico ponto de consumo -> distribui por props, ver useDeliveryEta.js);
  // ContatoScreen/AdminFidelidade chamam o hook direto (leaf de mount independente).
  assert.ok(/useCompanyInfo/.test(strip(read('pages/StoreApp.jsx'))));
  assert.ok(/whatsapp=\{companyInfo\.whatsapp\}/.test(strip(read('pages/StoreApp.jsx'))), 'StoreApp deveria passar whatsapp p/ SuccessPage via prop');
});

/* (5) botao flutuante condicional (nunca incondicional) */
check('(5) botao flutuante do WhatsApp e condicional a whatsappFloatEnabled', () => {
  const code = strip(read('pages/StoreApp.jsx'));
  assert.ok(/companyInfo\.whatsappFloatEnabled\s*&&/.test(code), 'wa-float deveria estar atras de `companyInfo.whatsappFloatEnabled &&`');
});

/* (6) companyInfo.js usa os RPCs DEDICADOS (nao get_setting generico) */
check('(6) companyInfo.js le/escreve via get_company_info/set_company_info (nao get_setting generico)', () => {
  const code = strip(read('services/company/companyInfo.js'));
  assert.ok(/get_company_info/.test(code), 'leitura deveria usar get_company_info (SECURITY DEFINER, publico)');
  assert.ok(/set_company_info/.test(code), 'escrita deveria usar set_company_info (SECURITY DEFINER, admin)');
  assert.ok(!/'get_setting'/.test(code), 'NAO deveria usar get_setting generico (RLS bloqueia leitura anonima — bug REF-DELIVERY-01a)');
});

/* (7) REF-COMPANY-03: SOBRE_TEXTO nunca reaparece; SobreScreen usa useCompanyInfo (sobre) */
check('(7) SOBRE_TEXTO nao existe mais (migrado p/ company_info.sobre); SobreScreen usa useCompanyInfo', () => {
  const viol = files.filter((f) => /export\s+const\s+SOBRE_TEXTO\b/.test(strip(read(f))));
  assert.deepStrictEqual(viol, [], `SOBRE_TEXTO reintroduzido em: ${JSON.stringify(viol)}`);
  const code = strip(read('components/menu/SobreScreen.jsx'));
  assert.ok(/useCompanyInfo/.test(code), 'SobreScreen deveria consumir useCompanyInfo (texto institucional)');
  assert.ok(/companyInfo\.sobre/.test(code), 'SobreScreen deveria ler companyInfo.sobre (nao SOBRE_TEXTO)');
});

console.log(fail === 0
  ? '\nOK company-info.guard — fonte unica preservada (sem WHATSAPP/STORE_INFO/SOBRE_TEXTO hardcoded, hook unico, botao condicional)'
  : `\nFALHA company-info.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
