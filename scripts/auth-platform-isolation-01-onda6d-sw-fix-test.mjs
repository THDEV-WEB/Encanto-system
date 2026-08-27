// scripts/auth-platform-isolation-01-onda6d-sw-fix-test.mjs — REF-AUTH-PLATFORM-ISOLATION-01 · Onda 6-D.
// Prova, ponta a ponta, com um BUILD REAL do admin (vite build --mode admin, Service Worker de verdade
// via `vite preview`) + navegador real (Playwright), que a correção do navigateFallbackDenylist resolve
// o bug encontrado na Onda 6-C: um Service Worker JA ATIVO no navegador (de uma visita anterior a
// admin.html) nao intercepta mais /convite.html.
//
// 100% dados descartaveis (projeto E2E). NAO usa encantomarmitaria@gmail.com, o Super Admin real nem
// Aquarios. Reverte toda config temporaria (allow-list do E2E) ao final.
//
// Pre-requisito: `npx vite build --mode admin` ja deve ter sido rodado (gera dist/ com o sw-admin.js
// corrigido) -- este script builda de novo no inicio, por garantia.
import { readFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

function lerEnvE2e() {
  const txt = readFileSync('.env.e2e', 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) { const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if (m) out[m[1]] = m[2]; }
  return out;
}
const env = lerEnvE2e();
const admin = createClient(env.VITE_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const SBP_TOKEN = process.env.SBP_TOKEN;
if (!SBP_TOKEN) { console.error('ERRO: defina SBP_TOKEN no ambiente (Personal Access Token do Supabase, so leitura/escrita de config do E2E).'); process.exit(2); }
const E2E_REF = 'bgzcrovskjbktdxkhemd';
const PORT = 4185;
const BASE = `http://localhost:${PORT}`;
const REDIRECT_TO = `${BASE}/convite.html`;

let passes = 0, failures = 0;
function check(desc, ok, detail) {
  if (ok) { passes++; console.log(`  [PASS] ${desc}`); }
  else { failures++; console.log(`  [FAIL] ${desc} -> ${detail ?? ''}`); }
}

async function getAuthConfig() {
  return fetch(`https://api.supabase.com/v1/projects/${E2E_REF}/config/auth`, { headers: { Authorization: `Bearer ${SBP_TOKEN}` } }).then((r) => r.json());
}
async function patchAuthConfig(body) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${E2E_REF}/config/auth`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${SBP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH auth config falhou: ${r.status}`);
}

console.log('==========================================================================');
console.log(' REF-AUTH-PLATFORM-ISOLATION-01 (Onda 6-D) · correcao do Service Worker -- E2E + navegador real');
console.log('==========================================================================\n');

const EMAIL_DESCARTAVEL = `onda6d-repro-${Date.now()}@teste.encanto.local`;
let userId = null;
let previewProc = null;
let allowListOriginal = null;

// Rede de seguranca: qualquer erro nao-tratado (ex.: spawn falhando de forma assincrona) ainda reverte
// a allow-list temporaria do E2E antes de encerrar -- nunca deixar config alterada por uma falha do script.
async function limpezaEmergencial(motivo) {
  console.error('\nERRO NAO TRATADO:', motivo);
  if (previewProc) previewProc.kill();
  if (allowListOriginal !== null) {
    await patchAuthConfig({ uri_allow_list: allowListOriginal }).catch(() => {});
    console.error('Allow-list revertida (rede de seguranca).');
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  process.exit(1);
}
process.on('uncaughtException', (e) => limpezaEmergencial(e.message));
process.on('unhandledRejection', (e) => limpezaEmergencial(e?.message || String(e)));

try {
  console.log('--- Setup: build admin (com a correcao) + allow-list temporaria no E2E ---');
  // IMPORTANTE: builda com as credenciais do projeto E2E (nao as de producao/.env) -- senao o bundle
  // do ConviteApp tenta validar o access_token do convite (emitido pelo projeto E2E) contra o projeto
  // ERRADO, e a API de Auth responde 403 (achado real ao rodar este teste pela 1a vez).
  execSync('npx vite build --mode admin', {
    stdio: 'inherit',
    env: { ...process.env, VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_KEY: env.VITE_SUPABASE_KEY },
  });
  const cfgAntes = await getAuthConfig();
  allowListOriginal = cfgAntes.uri_allow_list ?? '';
  const novaLista = (allowListOriginal ? allowListOriginal + ',' : '') + `${BASE}/**`;
  await patchAuthConfig({ uri_allow_list: novaLista });
  console.log('Allow-list temporaria adicionada (sera revertida no finally).');

  // shell:true -- no Windows, `npx` e' um .cmd (nao um executavel direto); spawn sem shell falha com ENOENT.
  previewProc = spawn('npx', ['vite', 'preview', '--mode', 'admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', shell: true });
  previewProc.on('error', (e) => console.error('erro no processo de preview:', e.message));
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('  [console.error]', msg.text()); });

  console.log('\n--- 1) Visita admin.html PRIMEIRO (simula visitante com o Service Worker ja ativo) ---');
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'load' });
  await page.evaluate(async () => { if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw-admin.js'); });
  await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
  await page.reload({ waitUntil: 'load' });
  const controlado = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check('2) Service Worker esta ativo/controlando a pagina antes do convite', controlado);

  console.log('\n--- 3-6) Gera convite real (generateLink) e navega ate ele com o navegador que JA TEM o SW ativo ---');
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'invite', email: EMAIL_DESCARTAVEL, options: { redirectTo: REDIRECT_TO },
  });
  check('convite gerado', !linkErr && !!linkData?.properties?.action_link, linkErr?.message);
  userId = linkData?.user?.id ?? null;

  await page.goto(linkData.properties.action_link, { waitUntil: 'load' });
  const urlLogoAposLoad = new URL(page.url());
  console.log(`  (diagnostico) path apos load: ${urlLogoAposLoad.pathname} | fragmento presente: ${urlLogoAposLoad.hash ? 'SIM' : 'NAO'}`);
  const titulo = await page.title();
  check('4) convite.html carregou o DOCUMENTO CORRETO (nao o shell do admin.html)', titulo.includes('Definir senha'), `title="${titulo}"`);

  console.log('\n--- 5) Confirma que o ConviteApp chegou ao estado correto ---');
  const senhaVisivel = await page.locator('[data-testid="convite-senha"]').waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(async (e) => {
    const linkInvalido = await page.getByText('Link inválido ou expirado').isVisible().catch(() => false);
    console.log(`  (nao ficou visivel a tempo -- "Link invalido" visivel: ${linkInvalido}; erro: ${e.message.split('\n')[0]})`);
    return false;
  });
  check('5) tela "Defina sua senha" visivel (ConviteApp processou a sessao do convite)', senhaVisivel);

  console.log('\n--- 6/7) Conclui o fluxo: define senha ---');
  const NOVA_SENHA = 'Onda6DSwFixSenha!3p9';
  if (senhaVisivel) {
    await page.locator('[data-testid="convite-senha"]').fill(NOVA_SENHA);
    await page.locator('[data-testid="convite-confirmar-senha"]').fill(NOVA_SENHA);
    await page.locator('[data-testid="convite-salvar"]').click();
    const salvo = await page.getByText('Senha definida').waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    check('6/7) tela "Senha definida" apareceu', salvo);
  }
  await context.close();
  await browser.close();

  console.log('\n--- 8/9/10) Logout (implicito, contexto novo) + login normal ---');
  const loginClient = anonClient();
  const { data: loginData, error: loginErr } = await loginClient.auth.signInWithPassword({ email: EMAIL_DESCARTAVEL, password: NOVA_SENHA });
  check('10) login normal (signInWithPassword) funciona apos o fluxo completo', !loginErr && !!loginData?.session, loginErr?.message);
  await loginClient.auth.signOut().catch(() => {});

  const { data: estadoFinal } = await admin.auth.admin.getUserById(userId);
  check('email_confirmed_at preenchido', !!estadoFinal?.user?.email_confirmed_at);
  check('last_sign_in_at preenchido', !!estadoFinal?.user?.last_sign_in_at);

  console.log('\n===== CONCLUSAO =====');
  console.log(failures === 0
    ? 'CORRECAO VALIDADA: mesmo com o Service Worker ja ativo, /convite.html chega corretamente ao ConviteApp -- fluxo completo ate login normal funciona.'
    : 'ATENCAO: ver [FAIL] acima.');
} finally {
  console.log('\n--- Limpeza ---');
  if (previewProc) { previewProc.kill(); console.log('Servidor de preview parado.'); }
  if (allowListOriginal !== null) {
    await patchAuthConfig({ uri_allow_list: allowListOriginal }).catch((e) => console.error('ERRO ao reverter allow-list:', e.message));
    console.log('Allow-list do E2E revertida ao estado original.');
  }
  if (userId) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('Usuario descartavel removido.');
  }
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
if (failures) process.exitCode = 1;
