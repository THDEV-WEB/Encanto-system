/* tests/company-name.guard.mjs — REF-COMPANY-02. Roda: node tests/company-name.guard.mjs
   GUARDA ESTRUTURAL da identidade institucional (nomeCurto/nomeCompleto). Falha se alguem reintroduzir
   o literal "Encanto" hardcoded em qualquer um dos ~9 pontos migrados nesta ref (client, admin, comanda,
   notificacoes). Analise estatica pura (sem banco/rede), mesmo espirito de company-info.guard.mjs
   (que trava telefone/whatsapp/e-mail — nenhuma das 6 invariantes de la cobria o NOME).

   ESCOPO — checagem por arquivo/padrao conhecido, NUNCA um scan cego de "Encanto" no repo inteiro
   (isso daria falso positivo nestes pontos, INTENCIONALMENTE fora do escopo):
     - index.html (<title> + texto do loader): HTML estatico servido ANTES do React montar — nao pode
       consumir company_info sem SSR/prerender/build-time injection (limitacao arquitetural documentada
       no ADR REF-COMPANY-02 §Decisao D, nao uma pendencia).
     - src/main.jsx (texto do Error Boundary de boot): deliberadamente independente da camada de dados,
       que pode ser a propria causa da falha — amarrar a useCompanyInfo() seria circular.
     - src/data/mockCatalog.js: "Encanto Mineiro/Clássico/Fit/..." sao NOMES DE PRODUTO, nao identidade
       institucional.
     - src/constants/storeInfo.js (SOBRE_TEXTO): tagline/texto institucional, fora de escopo desde a
       propria REF-COMPANY-01 (ADR §6) — nao e o "nome da empresa".
     - console.log('[Encanto] ...') em lib/supabase.js, lib/dbCliente.js, hooks/useProducts.js,
       hooks/useCategories.js, components/ProductCard.jsx: tags de log para debug, nunca visiveis ao
       usuario.
     - migrations/REF-ORDER-01b-whatsapp-dispatch.sql e migrations/REF-COMPANY-01-institutional-info.sql:
       migrations ANTIGAS, congeladas como registro historico — este projeto nunca edita uma migration
       em vigor (sempre CREATE OR REPLACE numa migration NOVA). O texto antigo "Encanto Delivery"/
       "nome" fica ali para sempre; quem importa e migrations/REF-COMPANY-02-*.sql (ja coberto pelo
       golden de paridade em tests/whatsapp-templates.golden.mjs). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const read = (relToSrc) => readFileSync(SRC + relToSrc, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/* (1) StoreApp.jsx: alt/texto do header vem de companyInfo.nomeCurto, nunca o literal "Encanto" */
check('(1) StoreApp.jsx: alt e texto do header vem de companyInfo.nomeCurto (sem "Encanto" hardcoded)', () => {
  const code = strip(read('pages/StoreApp.jsx'));
  assert.ok(!/alt="Encanto"/.test(code), 'alt="Encanto" hardcoded reapareceu no logo do header');
  assert.ok(!/>\s*Encanto\s*</.test(code) && !/^\s*Encanto\s*$/m.test(code), 'texto "Encanto" hardcoded reapareceu no brand-name');
  assert.ok(/alt=\{companyInfo\.nomeCurto\}/.test(code), 'alt do logo deveria vir de companyInfo.nomeCurto');
  assert.ok(/\{companyInfo\.nomeCurto\}/.test(code), 'brand-name deveria renderizar {companyInfo.nomeCurto}');
});

/* (2) StickyBar.jsx: alt do logo vem da prop brandName, nunca o literal "Encanto" */
check('(2) StickyBar.jsx: alt do logo vem da prop brandName (sem "Encanto" hardcoded)', () => {
  const code = strip(read('components/nav/StickyBar.jsx'));
  assert.ok(!/alt="Encanto"/.test(code), 'alt="Encanto" hardcoded reapareceu na barra sticky');
  assert.ok(/brandName/.test(code), 'StickyBar deveria receber/usar a prop brandName');
});

/* (3) AdminPanel.jsx: sidebar consome useCompanyInfo, nunca <span>Encanto</span> */
check('(3) AdminPanel.jsx: sidebar consome useCompanyInfo (sem <span>Encanto</span> hardcoded)', () => {
  const code = strip(read('components/admin/AdminPanel.jsx'));
  assert.ok(!/<span>Encanto<\/span>/.test(code), '<span>Encanto</span> hardcoded reapareceu na sidebar');
  assert.ok(/useCompanyInfo/.test(code), 'AdminPanel deveria consumir useCompanyInfo');
});

/* (4) AdminLogin.jsx: titulo consome useCompanyInfo, nunca "Encanto Admin" hardcoded */
check('(4) AdminLogin.jsx: titulo consome useCompanyInfo (sem "Encanto Admin" hardcoded)', () => {
  const code = strip(read('components/admin/AdminLogin.jsx'));
  assert.ok(!/Encanto Admin/.test(code), '"Encanto Admin" hardcoded reapareceu no titulo do login');
  assert.ok(/useCompanyInfo/.test(code), 'AdminLogin deveria consumir useCompanyInfo (get_company_info e publico, funciona pre-auth)');
});

/* (5) orderPayload.js (REF-CHECKOUT-02): buildOrderConfirmationMessage NAO monta mais o cabecalho
   da mensagem por conta propria — delega para buildComanda/comandaTexto (mesma fonte da comanda do
   Admin, checada pelo item (6) abaixo), repassando opts.companyInfo adiante. Sem hardcode aqui. */
check('(5) utils/orderPayload.js: buildOrderConfirmationMessage delega o nome da loja a buildComanda (sem "Encanto" hardcoded, sem montar cabecalho proprio)', () => {
  const code = strip(read('utils/orderPayload.js'));
  assert.ok(!/Encanto/.test(code), '"Encanto" hardcoded reapareceu em orderPayload.js');
  assert.ok(/import\s*\{\s*buildComanda\s*\}/.test(code), 'deveria importar buildComanda (fonte unica da comanda/mensagem)');
  assert.ok(/companyInfo:\s*opts\.companyInfo/.test(code), 'deveria repassar opts.companyInfo a buildComanda, nunca fixar o nome');
});

/* (6) comandaModel.js: loja.nome/loja.nomeFooter derivam de nomeCurto, nunca literais fixos */
check('(6) comandaModel.js: loja.nome/nomeFooter derivam de nomeCurto (sem "ENCANTO DELIVERY"/"Encanto Delivery" fixos)', () => {
  const code = strip(read('components/admin/comanda/comandaModel.js'));
  assert.ok(!/'ENCANTO DELIVERY'/.test(code), "'ENCANTO DELIVERY' hardcoded reapareceu");
  assert.ok(!/'Encanto Delivery'/.test(code), "'Encanto Delivery' hardcoded reapareceu");
  assert.ok(/nomeCurto\.toUpperCase\(\)/.test(code), 'loja.nome deveria derivar de nomeCurto.toUpperCase()');
  assert.ok(/nomeFooter/.test(code), 'view-model deveria expor loja.nomeFooter');
});

/* (7) comandaHtml.js / comandaTexto.js: rodape le loja.nomeFooter, nunca o literal fixo */
check('(7) comandaHtml.js / comandaTexto.js: rodape le loja.nomeFooter (sem "Encanto Delivery" fixo)', () => {
  for (const f of ['components/admin/comanda/comandaHtml.js', 'components/admin/comanda/comandaTexto.js']) {
    const code = strip(read(f));
    assert.ok(!/Encanto Delivery/.test(code), `${f}: "Encanto Delivery" hardcoded reapareceu no rodape`);
    assert.ok(/nomeFooter/.test(code), `${f}: rodape deveria ler v.loja?.nomeFooter`);
  }
});

/* (8) messageTemplates.js: os 5 templates usam {{empresa}}, nunca "Encanto Delivery" fixo */
check('(8) messageTemplates.js: os 5 templates usam {{empresa}} (sem "Encanto Delivery" fixo)', () => {
  const code = strip(read('services/notifications/messageTemplates.js'));
  assert.ok(!/Encanto Delivery/.test(code), '"Encanto Delivery" hardcoded reapareceu em algum template');
  const ocorrencias = (code.match(/\{\{empresa\}\}/g) || []).length;
  assert.equal(ocorrencias, 5, `esperava {{empresa}} nos 5 templates, achei ${ocorrencias}`);
});

/* (9) PedidoNotificacoes.jsx: previa ao vivo consome useCompanyInfo e passa empresa explicito */
check('(9) PedidoNotificacoes.jsx: previa consome useCompanyInfo e passa empresa: companyInfo.nomeCurto', () => {
  const code = strip(read('components/admin/PedidoNotificacoes.jsx'));
  assert.ok(/useCompanyInfo/.test(code), 'PedidoNotificacoes deveria consumir useCompanyInfo');
  assert.ok(/empresa:\s*companyInfo\.nomeCurto/.test(code), 'renderTemplate deveria receber empresa: companyInfo.nomeCurto (nao um literal)');
});

console.log(fail === 0
  ? '\nOK company-name.guard — identidade institucional sem hardcode remanescente nos pontos migrados'
  : `\nFALHA company-name.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
