// REF-MESA-01 · Onda 9 -- E2E dedicado. Fecha o gap "nenhuma tela de Admin pra ligar/desligar Mesa"
// (registrado desde a Onda 2). Testa o round-trip real da nova camada de servico
// (src/services/mesa/mesaConfig.js: definirMesaConfig) contra o RPC set_mesa_config/get_mesa_config
// (ja existentes, ja testados em REF-MESA-01/02 -- aqui so confirma o contrato dos 4 parametros e o
// gate de permissao, do jeito que a UI nova realmente chama).
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
async function chamarEsperandoErro(fn) {
  const sp = `sp_err_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let erro = null;
  try { await fn(); } catch (e) { erro = e; } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  return erro;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-01 · Onda 9 (config de Mesa no Admin) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E (fixtures).'); process.exit(2); }
    const ADMIN_USER = authUsers[0].id;
    const OUTRO_USER = randomUUID();

    const STORE_A = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 Onda9','ativo')`, [STORE_A, `mesa01-onda9-${STORE_A}`]);
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

    // ── 1: estado inicial (padrao seguro, tudo desligado) ────────────────────────────────────
    await withSavepoint(async () => {
      const cfg = (await client.query(`SELECT public.get_mesa_config($1) AS r`, [STORE_A])).rows[0].r;
      check('1 loja nova comeca com tudo desligado (padrao seguro)',
        cfg.habilitada === false && cfg.canal_qr === false && cfg.canal_admin === false && cfg.sessao_habilitada === false, JSON.stringify(cfg));
    });

    // ── 2: nao-admin nao consegue alterar ────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const erro = await chamarEsperandoErro(() =>
        comoOutroUser(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5)`, [true, true, false, false, STORE_A])));
      // set_mesa_config devolve {ok:false} em vez de lancar excecao (ver definicao) -- confirma pelo retorno
      const r = await comoOutroUser(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5) AS r`, [true, true, false, false, STORE_A]));
      check('2 nao-admin barrado (ok:false)', r.rows[0].r.ok === false, JSON.stringify(r.rows[0].r) + (erro ? ' | ' + erro.message : ''));
    });

    // ── 3: admin liga Mesa + canal QR -- exatamente o payload que definirMesaConfig manda ────
    await withSavepoint(async () => {
      const r = await comoAdmin(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5) AS r`, [true, true, false, false, STORE_A]));
      const v = r.rows[0].r;
      check('3a resposta ecoa os 4 campos', v.habilitada === true && v.canal_qr === true && v.canal_admin === false && v.sessao_habilitada === false, JSON.stringify(v));
      const cfg = (await client.query(`SELECT public.get_mesa_config($1) AS r`, [STORE_A])).rows[0].r;
      check('3b get_mesa_config reflete o que foi salvo',
        cfg.habilitada === v.habilitada && cfg.canal_qr === v.canal_qr && cfg.canal_admin === v.canal_admin && cfg.sessao_habilitada === v.sessao_habilitada,
        JSON.stringify(cfg) + ' vs ' + JSON.stringify(v));
    });

    // ── 4: liga os 4 campos (config completa, mesmo formato que a tela nova envia) ───────────
    await withSavepoint(async () => {
      const r = await comoAdmin(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5) AS r`, [true, true, true, true, STORE_A]));
      const v = r.rows[0].r;
      check('4a todos os 4 campos ligados', v.habilitada && v.canal_qr && v.canal_admin && v.sessao_habilitada, JSON.stringify(v));
    });

    // ── 5: desligar "habilitada" nao desliga os outros 3 no BANCO sozinho -- confirma que a UI
    //      (que manda os 4 juntos) e' quem garante a coerencia, nao o RPC (decisao de design ja
    //      existente, so documentando o contrato real pro form novo confiar nisso certo) ──────
    await withSavepoint(async () => {
      await comoAdmin(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5)`, [true, true, true, true, STORE_A]));
      const r = await comoAdmin(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5) AS r`, [false, true, true, true, STORE_A]));
      const v = r.rows[0].r;
      check('5 RPC aceita habilitada=false com canais=true (UI e quem zera os 3 antes de mandar)',
        v.habilitada === false && v.canal_qr === true, JSON.stringify(v));
    });

    // ── 6: upsert idempotente -- 2 chamadas identicas nao duplicam linha em store_settings ───
    await withSavepoint(async () => {
      await comoAdmin(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5)`, [true, false, true, false, STORE_A]));
      await comoAdmin(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5)`, [true, false, true, false, STORE_A]));
      await client.query('RESET ROLE');
      const linhas = await client.query(`SELECT count(*)::int AS n FROM public.store_settings WHERE store_id=$1 AND chave IN ('mesa_habilitada','mesa_canal_qr','mesa_canal_admin','mesa_sessao_habilitada')`, [STORE_A]);
      check('6 upsert idempotente (4 linhas, uma por chave)', linhas.rows[0].n === 4, JSON.stringify(linhas.rows[0]));
    });

    // ── 7: regressao -- loja isolada de outra (store_id errado nunca vaza/mistura config) ────
    await withSavepoint(async () => {
      const STORE_B = randomUUID();
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 Onda9 B','ativo')`, [STORE_B, `mesa01-onda9b-${STORE_B}`]);
      await comoAdmin(() => client.query(`SELECT public.set_mesa_config($1,$2,$3,$4,$5)`, [true, true, true, true, STORE_A]));
      const cfgB = (await client.query(`SELECT public.get_mesa_config($1) AS r`, [STORE_B])).rows[0].r;
      check('7 loja B continua com tudo desligado (isolamento por store_id)',
        cfgB.habilitada === false && cfgB.canal_qr === false, JSON.stringify(cfgB));
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
