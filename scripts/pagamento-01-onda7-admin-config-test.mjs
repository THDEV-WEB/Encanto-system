// REF-PAGAMENTO-01 · Onda 7 (admin config) -- E2E dedicado.
// set_pagamento_config: is_admin_of gate, formato da chave publica, exige chave pra habilitar,
// upsert idempotente, limpar chave (string vazia) remove a linha de store_settings.
// SAVEPOINT por caso.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) { const i = line.indexOf('='); if (i === -1) continue; map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  if (!map.PGPASSWORD) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: map.PGHOST, port: Number(map.PGPORT || 5432), user: map.PGUSER, password: map.PGPASSWORD, database: map.PGDATABASE || 'postgres' };
}
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, spCounter = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}
// Para chamadas que devem FALHAR: toma um savepoint proprio e sempre volta pra ele depois --
// sem isso, um erro real (RAISE EXCEPTION) deixa a transacao inteira em estado "aborted" e
// qualquer query seguinte no MESMO caso de teste quebra com 25P02.
async function chamarEsperandoErro(fn) {
  const sp = `sp_err_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let erro = null;
  try { await fn(); } catch (e) { erro = e; } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  return erro;
}

const TEST_KEY = 'TEST-25c32e88-3a54-42a0-8444-d8129f79029d';
const FAKE_ACCESS_TOKEN = 'TEST-1234567890123456-012345-0123456789abcdef0123456789abcdef-123456789';

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 7 (admin config) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    // is_admin_of exige que a linha em public.admins referencie um auth.users real (FK) -- usa
    // fixture existente do projeto E2E (mesmo padrao de mesa-02-onda4-mesas-fisicas-test.mjs). O
    // "estranho" (nao-admin) NAO precisa existir em auth.users -- is_admin_of so consulta
    // admins/super_admins por auth.uid(), simulado via claims.
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E (fixtures).'); process.exit(2); }
    const ADMIN_USER = authUsers[0].id;
    const OUTRO_USER = randomUUID();

    const STORE_A = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 Onda7','ativo')`, [STORE_A, `pagamento01-onda7-${STORE_A}`]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_USER, STORE_A]);

    async function comoAdmin(fn) {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_USER, role: 'authenticated' })]);
      await client.query(`SET LOCAL role authenticated`);
      return fn();
    }
    async function comoOutroUser(fn) {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OUTRO_USER, role: 'authenticated' })]);
      await client.query(`SET LOCAL role authenticated`);
      return fn();
    }

    // ── I1: nao-admin nao consegue alterar (sem permissao) ───────────────────────────────────
    await withSavepoint(async () => {
      const erro = await chamarEsperandoErro(() =>
        comoOutroUser(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [true, TEST_KEY, STORE_A])));
      check('I1 nao-admin barrado (sem permissao)', !!erro && /administradores/i.test(erro.message), erro?.message);
    });

    // ── I2: admin consegue habilitar com chave valida (TEST-) ────────────────────────────────
    await withSavepoint(async () => {
      const r = await comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3) AS r`, [true, TEST_KEY, STORE_A]));
      const v = r.rows[0].r;
      check('I2a resposta habilitada=true', v.habilitada === true, JSON.stringify(v));
      check('I2b resposta public_key ecoa a chave', v.public_key === TEST_KEY, JSON.stringify(v));
      const cfg = (await client.query(`SELECT public.get_pagamento_config($1) AS r`, [STORE_A])).rows[0].r;
      check('I2c get_pagamento_config reflete habilitada=true', cfg.habilitada === true, JSON.stringify(cfg));
      check('I2d get_pagamento_config reflete a chave', cfg.public_key === TEST_KEY, JSON.stringify(cfg));
    });

    // ── I3: habilitar sem chave (nunca configurada) -> erro claro, nao aplica ────────────────
    await withSavepoint(async () => {
      const erro = await chamarEsperandoErro(() =>
        comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [true, '', STORE_A])));
      check('I3 habilitar sem chave e barrado', !!erro && /informe a chave/i.test(erro.message), erro?.message);
      const cfg = (await client.query(`SELECT public.get_pagamento_config($1) AS r`, [STORE_A])).rows[0].r;
      check('I3b nada foi aplicado (continua desabilitada)', cfg.habilitada === false, JSON.stringify(cfg));
    });

    // ── I4: chave em formato invalido (ex.: colar Access Token por engano) -> erro claro ─────
    await withSavepoint(async () => {
      const erro = await chamarEsperandoErro(() =>
        comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [false, FAKE_ACCESS_TOKEN, STORE_A])));
      check('I4 chave em formato de access token e barrada', !!erro && /formato invalido/i.test(erro.message), erro?.message);
    });

    // ── I5: chave com prefixo de producao (APP_USR-) tambem e aceita ─────────────────────────
    await withSavepoint(async () => {
      const prodKey = 'APP_USR-25c32e88-3a54-42a0-8444-d8129f79029d';
      const r = await comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3) AS r`, [false, prodKey, STORE_A]));
      check('I5 chave APP_USR- aceita', r.rows[0].r.public_key === prodKey, JSON.stringify(r.rows[0].r));
    });

    // ── I6: limpar a chave (string vazia) remove a linha, nao deixa lixo ─────────────────────
    await withSavepoint(async () => {
      await comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [true, TEST_KEY, STORE_A]));
      await comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [false, '', STORE_A]));
      await client.query('RESET ROLE'); // store_settings tem RLS -- SELECT direto como 'authenticated' nao enxergaria a linha
      const linha = await client.query(`SELECT 1 FROM public.store_settings WHERE store_id=$1 AND chave='mp_public_key'`, [STORE_A]);
      check('I6 chave removida de store_settings', linha.rowCount === 0);
      const cfg = (await client.query(`SELECT public.get_pagamento_config($1) AS r`, [STORE_A])).rows[0].r;
      check('I6b get_pagamento_config public_key vira null', cfg.public_key === null, JSON.stringify(cfg));
    });

    // ── I7: upsert idempotente -- chamar 2x com o mesmo valor nao duplica linha ──────────────
    await withSavepoint(async () => {
      await comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [true, TEST_KEY, STORE_A]));
      await comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [true, TEST_KEY, STORE_A]));
      await client.query('RESET ROLE'); // idem I6 -- volta ao role privilegiado da conexao antes do SELECT direto
      const linhas = await client.query(`SELECT count(*)::int AS n FROM public.store_settings WHERE store_id=$1 AND chave IN ('pagamento_online_habilitada','mp_public_key')`, [STORE_A]);
      check('I7 upsert idempotente (1 linha por chave)', linhas.rows[0].n === 2, JSON.stringify(linhas.rows[0]));
    });

    // ── I8: p_habilitada nulo -> erro ─────────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const erro = await chamarEsperandoErro(() =>
        comoAdmin(() => client.query(`SELECT public.set_pagamento_config($1,$2,$3)`, [null, TEST_KEY, STORE_A])));
      check('I8 habilitada nulo e barrado', !!erro && /obrigatorio/i.test(erro.message), erro?.message);
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
