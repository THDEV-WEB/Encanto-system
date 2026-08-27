// scripts/auth-platform-isolation-01-onda6a-ttl-test.mjs — REF-AUTH-PLATFORM-ISOLATION-01 · Onda 6-A.
// Investigacao (NAO correcao). Reproduz o mecanismo real de convite (generateLink -> verify HTTPS ->
// redirect -> fragmento com access_token -> setSession -> updateUser(senha) -> signOut ->
// signInWithPassword) contra o projeto E2E, com 1 e-mail 100% descartavel -- mesma tecnica ja usada com
// sucesso em scripts/store-onboard-01-onda2-validacao-final.mjs (validacao real da Aquarios Bar).
//
// Objetivo desta reproducao: confirmar que o MECANISMO em si (Auth + ConviteApp.jsx) funciona hoje sem
// nenhum bug estrutural quando o link e' usado FRESCO -- isolando a causa da falha real observada
// (encantomarmitaria@gmail.com) para o fator temporal (mailer_otp_exp), nao um bug de codigo.
//
// NOTA IMPORTANTE (achado da auditoria de config, ja registrado): mailer_otp_exp e' 600s (10 min) em
// PRODUCAO mas 3600s (1h) no projeto E2E -- os dois ambientes tem TTLs diferentes. Por isso este script
// NAO tenta esperar o link expirar (levaria >1h aqui e ainda nao replicaria o numero exato de producao,
// que so' pode ser testado com leitura, nunca escrita, nesta onda). O papel deste teste e' confirmar que
// o caminho FRESCO funciona ponta a ponta -- a causa mais provavel (token expirado por atraso de
// abertura do e-mail em spam) fica registrada como hipotese PROVAVEL, nao CONFIRMADA por espera real.
//
// NAO usa: Super Admin real, encantomarmitaria@gmail.com, aquariosbar806@gmail.com, ou qualquer usuario
// real de producao. Roda 100% contra o projeto E2E (bgzcrovskjbktdxkhemd). Nao altera nenhuma
// configuracao (nem producao nem E2E).
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

const EMAIL_DESCARTAVEL = `onda6a-teste-convite-${Date.now()}@teste.encanto.local`;
const NOVA_SENHA = 'Onda6ATesteSenha!1x9k';
let userId = null;

console.log('==========================================================================');
console.log(' REF-AUTH-PLATFORM-ISOLATION-01 (Onda 6-A) · reproducao do mecanismo de convite FRESCO (E2E)');
console.log('==========================================================================\n');

try {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'invite', email: EMAIL_DESCARTAVEL,
  });
  check('generateLink retornou action_link', !linkErr && !!linkData?.properties?.action_link, linkErr?.message);
  userId = linkData?.user?.id ?? null;

  let accessToken = null, refreshToken = null, location = null;
  if (linkData?.properties?.action_link) {
    const resp = await fetch(linkData.properties.action_link, { redirect: 'manual' });
    location = resp.headers.get('location');
    check('verify (HTTPS real) devolveu redirect 3xx', resp.status >= 300 && resp.status < 400, `status=${resp.status}`);
    if (location?.includes('#')) {
      const frag = new URLSearchParams(location.split('#')[1]);
      accessToken = frag.get('access_token');
      refreshToken = frag.get('refresh_token');
    }
    check('fragmento traz access_token+refresh_token (mesmo formato que ConviteApp.jsx consome via detectSessionInUrl)', !!accessToken && !!refreshToken, location);
  }

  if (accessToken && refreshToken) {
    const conviteClient = anonClient();
    const { data: setData, error: setErr } = await conviteClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    check('sessao real estabelecida a partir do token do convite', !setErr && !!setData?.session, setErr?.message);

    const { error: updErr } = await conviteClient.auth.updateUser({ password: NOVA_SENHA });
    check('senha definida com sucesso (mesma chamada de ConviteApp.jsx)', !updErr, updErr?.message);
    await conviteClient.auth.signOut().catch(() => {});

    const { data: check1 } = await admin.auth.admin.getUserById(userId);
    check('email_confirmed_at foi preenchido pelo verify (nao fica NULL quando o link e usado fresco)', !!check1?.user?.email_confirmed_at, JSON.stringify(check1?.user?.email_confirmed_at));

    const loginClient = anonClient();
    const { data: loginData, error: loginErr } = await loginClient.auth.signInWithPassword({ email: EMAIL_DESCARTAVEL, password: NOVA_SENHA });
    check('login real pos-convite funciona (signInWithPassword)', !loginErr && !!loginData?.session, loginErr?.message);
    await loginClient.auth.signOut().catch(() => {});
  }

  console.log('\n===== CONCLUSAO =====');
  if (failures === 0) {
    console.log('Mecanismo de convite (Auth + mesma sequencia de chamadas de ConviteApp.jsx) funciona SEM NENHUM bug estrutural quando o link e usado fresco.');
    console.log('Reforca a hipotese de causa raiz real: nao e um bug de codigo -- e o TEMPO decorrido ate o clique (e-mail em spam + mailer_otp_exp=600s em producao).');
  } else {
    console.log('ATENCAO: o mecanismo falhou mesmo fresco -- ver [FAIL] acima. Pode existir um bug estrutural alem da hipotese de TTL.');
  }
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nLimpeza: usuario descartavel removido.');
  }
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
if (failures) process.exitCode = 1;
