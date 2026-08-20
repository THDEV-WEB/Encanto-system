// REF-STORE-ONBOARD-01 · Onda 2 (Opção C) — suite de testes do padrão .lojas.valionsistemas.com.br.
// Camada A (estrutural) + Camada B (comportamental, BEGIN...ROLLBACK) — mesmo padrão de
// store-onboard-01-onda1-config-status-test.mjs. Cobre os itens A-J e L do checklist aprovado pelo
// dono; K (convite real -> redirect .lojas.) fica pendente de DNS/deploy real, fora do alcance de um
// teste de banco puro.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const envTxt = readFileSync('C:/Users/00thi/.encanto/db.env', 'utf8');
const get = (k) => { const m = envTxt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim() : null; };
const client = new pg.Client({
  host: get('PGHOST'), port: Number(get('PGPORT') || 5432), user: get('PGUSER'),
  password: get('PGPASSWORD'), database: get('PGDATABASE') || 'postgres',
  ssl: { rejectUnauthorized: false }, statement_timeout: 15000, connectionTimeoutMillis: 15000,
});

const BAR_DA_SOGRA_ID = '776a01c8-f836-417a-a957-a0e1109f90a2';
const ENCANTO_ID = '8604324d-0529-443d-aa79-4337057bfa01';
const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // super admin real (ja usado em testes anteriores desta REF)

let pass = 0, fail = 0;
const out = (s) => console.log(s);
const check = (nome, cond, detalhe = '') => {
  if (cond) { pass++; out(`  [PASS] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
  else { fail++; out(`  [FAIL] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
};

async function main() {
  await client.connect();

  out('\n=== Camada A: get_store_by_domain -- padrao novo (.lojas.) ===');
  {
    const r = await client.query(`SELECT store_id FROM public.get_store_by_domain($1)`, ['bar-da-sogra.lojas.valionsistemas.com.br']);
    check('A: bar-da-sogra.lojas... resolve Bar da Sogra', r.rows[0]?.store_id === BAR_DA_SOGRA_ID, r.rows[0]?.store_id);
  }
  {
    // get_store_by_domain resolve STOREFRONT por hostname -- admin-{slug} nao e um host de storefront
    // (isso e' roteamento do vercel.json, testado separadamente abaixo em D). Aqui so confirmo que um
    // hostname de admin NAO e' erroneamente tratado como storefront de outra loja (cai no default).
    const r = await client.query(`SELECT store_id FROM public.get_store_by_domain($1)`, ['admin-bar-da-sogra.lojas.valionsistemas.com.br']);
    const defaultId = (await client.query(`SELECT public.default_store_id() AS id`)).rows[0].id;
    check('B: admin-bar-da-sogra.lojas... NAO e tratado como storefront de outra loja (cai no default, nunca em bar-da-sogra por engano)',
      r.rows[0]?.store_id === defaultId, r.rows[0]?.store_id);
  }
  {
    const r = await client.query(`SELECT store_id FROM public.get_store_by_domain($1)`, ['encanto.valionsistemas.com.br']);
    check('C: encanto.valionsistemas.com.br continua resolvendo Encanto (legado intacto)', r.rows[0]?.store_id === ENCANTO_ID, r.rows[0]?.store_id);
  }
  {
    const r = await client.query(`SELECT store_id FROM public.get_store_by_domain($1)`, ['hostname-totalmente-desconhecido-xyz.com']);
    const defaultId = (await client.query(`SELECT public.default_store_id() AS id`)).rows[0].id;
    check('E: hostname desconhecido cai no default_store_id() (comportamento documentado, nunca "nao encontrado")',
      r.rows[0]?.store_id === defaultId, r.rows[0]?.store_id);
  }

  out('\n=== Camada A: vercel.json -- roteamento por host (item D, regex estatica) ===');
  {
    const vercelJson = JSON.parse(readFileSync('C:/Projetos/Encanto/encanto-react/vercel.json', 'utf8'));
    const adminRules = vercelJson.rewrites.filter(r => r.destination === '/admin.html').map(r => r.has[0].value);
    const storefrontRules = vercelJson.redirects.filter(r => r.destination === '/encanto').map(r => r.has[0].value);

    const testeHost = (padroes, host) => padroes.some(p => new RegExp(p).test(host));

    check('D: admin-bar-da-sogra.lojas.valionsistemas.com.br roteia pro admin.html', testeHost(adminRules, 'admin-bar-da-sogra.lojas.valionsistemas.com.br'));
    check('D: admin.encanto.valionsistemas.com.br continua roteando pro admin.html (legado)', testeHost(adminRules, 'admin.encanto.valionsistemas.com.br'));
    check('D2: bar-da-sogra.lojas.valionsistemas.com.br roteia pro storefront (/encanto)', testeHost(storefrontRules, 'bar-da-sogra.lojas.valionsistemas.com.br'));
    check('D3: encanto.valionsistemas.com.br continua roteando pro storefront (legado)', testeHost(storefrontRules, 'encanto.valionsistemas.com.br'));
    check('D4: a regra de storefront NAO captura um host de admin (admin-x.lojas...)', !testeHost(storefrontRules, 'admin-bar-da-sogra.lojas.valionsistemas.com.br'));
  }

  out('\n=== Camada B: resolve_store_from_origin (guest checkout) -- BEGIN...ROLLBACK ===');
  await client.query('BEGIN');
  try {
    const comOrigin = async (origin) => {
      await client.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ origin })]);
      const r = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
      return r.rows[0].id;
    };

    check('F: Origin bar-da-sogra.lojas... resolve Bar da Sogra',
      (await comOrigin('https://bar-da-sogra.lojas.valionsistemas.com.br')) === BAR_DA_SOGRA_ID);

    check('G: Origin encanto.valionsistemas.com.br resolve SOMENTE Encanto (mapeamento preciso, sem contaminacao cruzada)',
      (await comOrigin('https://encanto.valionsistemas.com.br')) === ENCANTO_ID);

    check('H: Origin desconhecido -> DENY (NULL, fail-closed)',
      (await comOrigin('https://site-nada-a-ver.com')) === null);

    await client.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({})]);
    const rSemOrigin = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
    check('H2: sem header Origin nenhum -> DENY (NULL, fail-closed)', rSemOrigin.rows[0].id === null);
  } finally {
    await client.query('ROLLBACK');
  }

  out('\n=== Camada B: provision_store -- dominio automatico + guarda admin- -- BEGIN...ROLLBACK ===');
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_REAL_USER_ID, role: 'authenticated' })]);
    await client.query('SET LOCAL ROLE authenticated');

    const sp1 = 'onda2_i';
    await client.query(`SAVEPOINT ${sp1}`);
    const rI = await client.query(`SELECT public.provision_store($1, $2) AS r`, ['Loja Teste Onda2', 'loja-teste-onboard01-onda2']);
    const dominioGerado = rI.rows[0].r.dominio;
    check('I: provision_store gera dominio automatico no padrao novo',
      dominioGerado === 'loja-teste-onboard01-onda2.lojas.valionsistemas.com.br', dominioGerado);

    const sp2 = 'onda2_j';
    await client.query(`SAVEPOINT ${sp2}`);
    let negouSlugAdmin = false, motivoJ = '';
    try {
      await client.query(`SELECT public.provision_store($1, $2)`, ['Tentativa invalida', 'admin-teste-colisao']);
    } catch (e) {
      negouSlugAdmin = true; motivoJ = e.message;
    }
    check('J: slug comecando com "admin-" e rejeitado', negouSlugAdmin, motivoJ);
    await client.query(`ROLLBACK TO SAVEPOINT ${sp2}`);
  } finally {
    await client.query('ROLLBACK'); // mutacao liquida = 0 -- loja de teste e tentativa negada, ambas desfeitas
  }
  {
    const residuo = await client.query(`SELECT count(*)::int AS n FROM public.stores WHERE slug IN ('loja-teste-onboard01-onda2','admin-teste-colisao')`);
    check('I/J: nenhuma loja de teste sobrou apos o ROLLBACK (mutacao liquida = 0)', residuo.rows[0].n === 0, `n=${residuo.rows[0].n}`);
  }

  out('\n=== Camada A: loja legada -- redirect antigo preservado (item L) ===');
  {
    const r = await client.query(`SELECT dominio FROM public.stores WHERE id=$1`, [ENCANTO_ID]);
    const dominio = r.rows[0].dominio;
    const legado = typeof dominio === 'string' && dominio.endsWith('.valionsistemas.com.br') && !dominio.endsWith('.lojas.valionsistemas.com.br');
    check('L: Encanto ainda tem dominio no padrao legado (Edge Function vai usar redirectTo antigo)', legado, dominio);
  }
  {
    const r = await client.query(`SELECT dominio FROM public.stores WHERE id=$1`, [BAR_DA_SOGRA_ID]);
    const dominio = r.rows[0].dominio;
    const novo = dominio === 'bar-da-sogra.lojas.valionsistemas.com.br';
    check('L2: Bar da Sogra tem dominio no padrao NOVO (Edge Function vai usar redirectTo .lojas.)', novo, dominio);
  }

  out(`\n${'='.repeat(66)}\n RESULTADO: ${pass} passes, ${fail} failures\n${'='.repeat(66)}`);
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error('ERRO FATAL:', e.message); try { await client.query('ROLLBACK'); } catch {} await client.end(); process.exit(1); });
