// scripts/auth-platform-isolation-01-onda6b-fase1-e2e-test.mjs — REF-AUTH-PLATFORM-ISOLATION-01 · Onda 6-B, Fase 1.
// Gate obrigatorio ANTES de alterar mailer_otp_exp em producao: valida o fluxo completo de convite no
// projeto E2E, incluindo o item que a Onda 6-A ainda nao tinha checado explicitamente -- last_sign_in_at
// apos o login real. 100% dados descartaveis, projeto E2E (bgzcrovskjbktdxkhemd).
//
// convite -> abertura (verify HTTPS) -> confirmacao (email_confirmed_at) -> sessao -> senha -> logout
// -> login normal -> confirma email_confirmed_at -> confirma last_sign_in_at.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function lerEnvE2e() {
  const txt = readFileSync('.env.e2e', 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) { const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if (m) out[m[1]] = m[2]; }
  return out;
}
const env = lerEnvE2e();
const admin = createClient(env.VITE_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let passes = 0, failures = 0;
function check(desc, ok, detail) {
  if (ok) { passes++; console.log(`  [PASS] ${desc}`); }
  else { failures++; console.log(`  [FAIL] ${desc} -> ${detail ?? ''}`); }
}

const EMAIL_DESCARTAVEL = `onda6b-fase1-${Date.now()}@teste.encanto.local`;
const NOVA_SENHA = 'Onda6BFase1Senha!7q2';
let userId = null;

console.log('==========================================================================');
console.log(' REF-AUTH-PLATFORM-ISOLATION-01 (Onda 6-B · Fase 1) · fluxo completo de convite (E2E)');
console.log('==========================================================================\n');

try {
  console.log('--- 1. Convite ---');
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'invite', email: EMAIL_DESCARTAVEL });
  check('convite gerado (generateLink, mesmo mecanismo de inviteUserByEmail)', !linkErr && !!linkData?.properties?.action_link, linkErr?.message);
  userId = linkData?.user?.id ?? null;

  console.log('\n--- 2. Abertura (verify HTTPS real) ---');
  let accessToken = null, refreshToken = null;
  const resp = await fetch(linkData.properties.action_link, { redirect: 'manual' });
  const location = resp.headers.get('location');
  check('verify devolveu redirect 3xx', resp.status >= 300 && resp.status < 400, `status=${resp.status}`);
  if (location?.includes('#')) {
    const frag = new URLSearchParams(location.split('#')[1]);
    accessToken = frag.get('access_token');
    refreshToken = frag.get('refresh_token');
  }
  check('fragmento traz access_token+refresh_token', !!accessToken && !!refreshToken, location);

  console.log('\n--- 3. Confirmacao (email_confirmed_at logo apos o verify) ---');
  const { data: apos1 } = await admin.auth.admin.getUserById(userId);
  check('email_confirmed_at preenchido logo apos o verify', !!apos1?.user?.email_confirmed_at, JSON.stringify(apos1?.user?.email_confirmed_at));

  console.log('\n--- 4. Estabelecimento da sessao ---');
  const conviteClient = anonClient();
  const { data: setData, error: setErr } = await conviteClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  check('sessao estabelecida a partir do token do convite', !setErr && !!setData?.session, setErr?.message);

  console.log('\n--- 5. Definicao de senha ---');
  const { error: updErr } = await conviteClient.auth.updateUser({ password: NOVA_SENHA });
  check('senha definida (updateUser, mesma chamada de ConviteApp.jsx)', !updErr, updErr?.message);

  console.log('\n--- 6. Logout ---');
  const { error: signOutErr } = await conviteClient.auth.signOut();
  check('logout da sessao temporaria', !signOutErr, signOutErr?.message);

  console.log('\n--- 7. Login normal ---');
  const loginClient = anonClient();
  const { data: loginData, error: loginErr } = await loginClient.auth.signInWithPassword({ email: EMAIL_DESCARTAVEL, password: NOVA_SENHA });
  check('login normal (signInWithPassword) funciona', !loginErr && !!loginData?.session, loginErr?.message);
  await loginClient.auth.signOut().catch(() => {});

  console.log('\n--- 8/9. Confirmacao final: email_confirmed_at + last_sign_in_at ---');
  const { data: apos2 } = await admin.auth.admin.getUserById(userId);
  check('email_confirmed_at continua preenchido', !!apos2?.user?.email_confirmed_at, JSON.stringify(apos2?.user?.email_confirmed_at));
  check('last_sign_in_at foi preenchido pelo login real', !!apos2?.user?.last_sign_in_at, JSON.stringify(apos2?.user?.last_sign_in_at));

  console.log('\n===== CONCLUSAO =====');
  console.log(failures === 0 ? 'FASE 1 VERDE — fluxo completo de convite funciona ponta a ponta no E2E (mailer_otp_exp=3600s).' : 'FASE 1 COM FALHAS — ver [FAIL] acima.');
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nLimpeza: usuario descartavel removido.');
  }
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
if (failures) process.exitCode = 1;
