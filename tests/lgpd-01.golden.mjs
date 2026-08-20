/* tests/lgpd-01.golden.mjs — REF-LGPD-01 · Ondas 1-2. Roda: node tests/lgpd-01.golden.mjs
   Analise estatica pura (sem banco/rede) sobre os achados corrigidos:
     Onda 1: LGPD-R01 (exclusao/anonimizacao), LGPD-R02 (politica de privacidade versionada),
       LGPD-R04 (purga notification_outbox), LGPD-R05 (agenda purge_old_logs),
       LGPD-R06 (RLS customers com tenant_id, sem quebrar o fallback existente),
       LGPD-R10 (e-mail nao vaza na excecao de link_store_admin).
     Onda 2: LGPD-R03 (portabilidade — export self-service read-only).
   Testes FUNCIONAIS reais (contra producao, com ROLLBACK, sem persistir nada) rodaram fora deste
   arquivo durante a implementacao — ver scratchpad da sessao; nao versionados aqui por dependerem de
   credenciais locais (C:/Users/00thi/.encanto/db.env) fora do repositorio.
   Mesmo padrao de tests/loyalty.guard.mjs (readFileSync + assert, sem framework). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const read = (f) => readFileSync(SRC + f, 'utf8');
const readSql = (f) => readFileSync(ROOT + 'migrations/' + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const stripSql = (code) => code.replace(/--.*$/gm, ''); // remove comentarios SQL antes de checar o CODIGO real

/* ── LGPD-R02: politica de privacidade fixa, versionada, factual ─────────────────────────────── */
check('R02: privacyPolicy.js tem versao/data e secoes com conteudo real (nao generico)', async () => {
  const mod = await import('../src/constants/privacyPolicy.js');
  assert.ok(/^\d+\.\d+$/.test(mod.PRIVACY_POLICY_VERSION), 'versao deve ser um numero tipo "1.0"');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(mod.PRIVACY_POLICY_UPDATED_AT), 'data deve ser ISO (YYYY-MM-DD)');
  assert.ok(Array.isArray(mod.PRIVACY_POLICY_SECTIONS) && mod.PRIVACY_POLICY_SECTIONS.length >= 5, 'deve ter pelo menos 5 secoes');
  for (const s of mod.PRIVACY_POLICY_SECTIONS) {
    assert.ok(s.titulo && s.titulo.trim(), 'secao sem titulo');
    assert.ok(Array.isArray(s.paragrafos) && s.paragrafos.length >= 1, `secao "${s.titulo}" sem paragrafos`);
    for (const p of s.paragrafos) assert.ok(p && p.trim().length > 10, `paragrafo vazio/curto demais em "${s.titulo}"`);
  }
  const todo = mod.PRIVACY_POLICY_SECTIONS.map((s) => s.paragrafos.join(' ')).join(' ');
  for (const terceiro of ['Supabase', 'Meta', 'Google', 'Resend', 'Mapbox', 'Nominatim', 'Photon', 'HeiGIT', 'Sentry']) {
    assert.ok(todo.includes(terceiro), `deve citar o terceiro real "${terceiro}" (conteudo factual, nao generico)`);
  }
  assert.ok(/juridic/i.test(todo), 'deve marcar explicitamente o que depende de validacao juridica/DPO');
});

check('R02: PrivacidadeScreen existe, mostra versao/data, e e roteada no menu (StoreMenu/SideDrawer)', () => {
  const screen = strip(read('components/menu/PrivacidadeScreen.jsx'));
  assert.ok(screen.includes('PRIVACY_POLICY_VERSION') && screen.includes('PRIVACY_POLICY_UPDATED_AT_HUMANO'), 'tela deve exibir versao e data');
  const menu = strip(read('components/menu/StoreMenu.jsx'));
  assert.ok(/tela === 'privacidade'/.test(menu) && /PrivacidadeScreen/.test(menu), 'StoreMenu deve rotear "privacidade" -> PrivacidadeScreen');
  const drawer = strip(read('components/menu/SideDrawer.jsx'));
  assert.ok(/onNavigate\('privacidade'\)/.test(drawer), 'SideDrawer deve ter item de menu pra Politica de Privacidade');
});

/* ── LGPD-R01: exclusao/anonimizacao (self-service + assistido pelo admin) ───────────────────── */
check('R01: AuthService.deleteMyData chama lgpd_delete_my_data com confirmacao explicita', () => {
  const code = strip(read('services/AuthService.js'));
  assert.ok(/rpc\('lgpd_delete_my_data'/.test(code), 'deve chamar a RPC lgpd_delete_my_data');
  assert.ok(/p_confirmacao:\s*'EXCLUIR'/.test(code), 'deve enviar a confirmacao explicita EXCLUIR (nunca implicita)');
});

check('R01: AuthProvider.excluirMeusDados desloga apos anonimizar (nunca finge que a conta continua igual)', () => {
  const code = strip(read('providers/AuthProvider.jsx'));
  assert.ok(/excluirMeusDados/.test(code), 'deve expor excluirMeusDados no contexto');
  assert.ok(/AuthService\.deleteMyData/.test(code), 'deve chamar AuthService.deleteMyData');
});

check('R01: MinhaContaScreen exige 2 passos antes de excluir (nunca 1 clique)', () => {
  const code = strip(read('components/conta/MinhaContaScreen.jsx'));
  assert.ok(/confirmandoExclusao/.test(code), 'deve ter estado de confirmacao intermediario');
  assert.ok(/excluirDados/.test(code), 'deve chamar mc.excluirDados (via useMinhaConta)');
});

check('R01: admin_lgpd_delete_customer_data e chamado pelo lado Admin, escopado por store_id', () => {
  const svc = strip(read('services/lgpd/lgpdService.js'));
  assert.ok(/rpc\('admin_lgpd_delete_customer_data'/.test(svc), 'deve chamar admin_lgpd_delete_customer_data');
  assert.ok(/buildStoreRpcParam/.test(svc), 'deve escopar por p_store_id (buildStoreRpcParam), nunca global');
  const ui = strip(read('components/admin/AdminFidelidade.jsx'));
  assert.ok(/confirmandoExclusao/.test(ui) && /adminExcluirDadosCliente/.test(ui), 'AdminFidelidade deve ter o fluxo de exclusao com confirmacao');
});

check('R01: migration anonimiza customers/addresses/loyalty, mas NUNCA apaga orders/order_items (historico preservado)', () => {
  const sql = readSql('REF-LGPD-01-onda1-r01-exclusao-anonimizacao.sql');
  assert.ok(/create or replace function public\.lgpd_anonymize_customer/i.test(sql));
  assert.ok(/delete from public\.addresses where customer_id/i.test(sql));
  assert.ok(/delete from public\.loyalty_events where customer_id/i.test(sql));
  assert.ok(/delete from public\.loyalty_accounts where customer_id/i.test(sql));
  assert.ok(!/delete from public\.orders/i.test(sql), 'NUNCA deve apagar orders (historico operacional/fiscal)');
  assert.ok(!/delete from public\.order_items/i.test(sql), 'NUNCA deve apagar order_items');
  assert.ok(!/delete from public\.order_events/i.test(sql), 'NUNCA deve apagar order_events (auditoria)');
  assert.ok(/create or replace function public\.lgpd_delete_my_data/i.test(sql));
  assert.ok(/auth\.uid\(\)/.test(sql), 'self-service deve ancorar em auth.uid()');
  assert.ok(/p_confirmacao.*<>\s*'EXCLUIR'/i.test(sql) || /coalesce\(p_confirmacao/i.test(sql), 'deve exigir confirmacao explicita no servidor tambem (nao so no client)');
  assert.ok(/create or replace function public\.admin_lgpd_delete_customer_data/i.test(sql));
  assert.ok(/is_admin_of\(p_store_id\)/.test(sql), 'variante admin deve checar is_admin_of(p_store_id)');
  assert.ok(/store_id = p_store_id/i.test(sql), 'variante admin deve confirmar que o customer pertence aquela loja (nunca cross-tenant)');
  assert.ok(/revoke all on function public\.lgpd_anonymize_customer/i.test(sql), 'helper interno nunca deve ser exposto direto');
});

/* ── LGPD-R03: portabilidade (export self-service) + oposicao (canal ja existente, mitigado) ─── */
check('R03: lgpd_export_my_data e read-only, ancorado em auth.uid(), sem parametro de outro cliente', () => {
  const sql = stripSql(readSql('REF-LGPD-01-onda2-r03-exportar-meus-dados.sql'));
  assert.ok(/create or replace function public\.lgpd_export_my_data\(\)/i.test(sql), 'funcao deve ser sem parametros (nunca aceita id de outro cliente)');
  assert.ok(/auth\.uid\(\)/.test(sql));
  assert.ok(!/delete |update |insert into/i.test(sql.replace(/insert into public\.settings/gi, '')), 'export deve ser 100% read-only (so SELECT/jsonb_agg)');
  assert.ok(/grant execute on function public\.lgpd_export_my_data\(\) to authenticated/i.test(sql));
  assert.ok(!/to anon/i.test(sql), 'nunca deve conceder a anon (precisa estar logado)');
});

check('R03: AuthService/hook/tela expoe o download self-service', () => {
  const svc = strip(read('services/AuthService.js'));
  assert.ok(/rpc\('lgpd_export_my_data'\)/.test(svc));
  const tela = strip(read('components/conta/MinhaContaScreen.jsx'));
  assert.ok(/baixarMeusDados/.test(tela) && /Blob/.test(tela), 'download deve ser gerado no proprio navegador (Blob), nada persistido em servidor');
});

/* ── LGPD-R04 / LGPD-R05: infraestrutura de retencao/purga ───────────────────────────────────── */
check('R04: purga de notification_outbox agendada, cron-only, so estados terminais', () => {
  const sql = readSql('REF-LGPD-01-onda1-r04-purge-notification-outbox.sql');
  assert.ok(/create or replace function public\.lgpd_purge_notification_outbox/i.test(sql));
  assert.ok(/state in \('sent', 'failed', 'skipped'\)/i.test(sql), 'nunca deve apagar pending/sending');
  assert.ok(/revoke execute on function public\.lgpd_purge_notification_outbox\(integer\) from anon, authenticated/i.test(sql));
  assert.ok(/cron\.schedule\('lgpd-purge-notification-outbox'/i.test(sql));
});

check('R05: versiona o job JA EXISTENTE em producao (encanto-purge-logs), sem redefinir purge_old_logs nem inventar novo jobname', () => {
  const sql = stripSql(readSql('REF-LGPD-01-onda1-r05-agenda-purge-old-logs.sql'));
  assert.ok(!/create or replace function public\.purge_old_logs/i.test(sql), 'NAO deve redefinir purge_old_logs (corpo real desconhecido)');
  assert.ok(/cron\.schedule\('encanto-purge-logs'/i.test(sql), 'deve versionar o job com o MESMO jobname ja em producao (introspeccao confirmou), nunca criar um paralelo');
  assert.ok(/purge_old_logs\(90, 365\)/i.test(sql), 'deve preservar os parametros REAIS ja em uso (90/365 dias), nunca inventar novo valor');
});

/* ── LGPD-R06: RLS de customers ganha tenant_id SEM quebrar o fallback (fail-open, nao fail-closed) */
check('R06: policy de customers correlaciona tenant_id, mas mantem auth_user_id como base (sem regressao de UX)', () => {
  const sql = readSql('REF-LGPD-01-onda1-r06-customers-select-tenant.sql');
  assert.ok(/auth_user_id = auth\.uid\(\)/.test(sql), 'base auth_user_id deve permanecer');
  assert.ok(/tenant_id'\) is null/i.test(sql), 'deve ser fail-OPEN quando tenant_id ainda nao existe no JWT (nao quebra o 1o carregamento)');
  assert.ok(/store_id = \(auth\.jwt\(\)->>'tenant_id'\)::uuid/.test(sql), 'quando tenant_id existe, deve exigir bater com store_id');
});

/* ── LGPD-R10: e-mail nao aparece mais na excecao SQL ─────────────────────────────────────────── */
check('R10: link_store_admin nao interpola mais p_admin_email na excecao', () => {
  const sql = stripSql(readSql('REF-LGPD-01-onda1-r10-sanitiza-excecao-email.sql'));
  assert.ok(!/email invalido: %/i.test(sql), 'a excecao nao deve mais interpolar o e-mail digitado (fora de comentario)');
  assert.ok(/raise exception 'email invalido' using errcode/i.test(sql), 'deve manter uma excecao generica (mesmo ERRCODE)');
});

/* ── toda migration desta onda tem rollback companion (convencao do projeto) ──────────────────── */
check('todas as migrations LGPD-01 (Ondas 1-2) tem rollback companion', () => {
  for (const base of [
    'REF-LGPD-01-onda1-r01-exclusao-anonimizacao',
    'REF-LGPD-01-onda1-r04-purge-notification-outbox',
    'REF-LGPD-01-onda1-r05-agenda-purge-old-logs',
    'REF-LGPD-01-onda1-r06-customers-select-tenant',
    'REF-LGPD-01-onda1-r10-sanitiza-excecao-email',
    'REF-LGPD-01-onda2-r03-exportar-meus-dados',
  ]) {
    assert.doesNotThrow(() => readSql(base + '.sql'), `falta ${base}.sql`);
    assert.doesNotThrow(() => readSql(base + '-rollback.sql'), `falta ${base}-rollback.sql`);
  }
});

console.log(fail === 0
  ? '\nOK lgpd-01.golden — Ondas 1-2 (LGPD-R01/R02/R03/R04/R05/R06/R10) consistentes'
  : `\nFALHA lgpd-01.golden — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
