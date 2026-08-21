// REF-STORE-ONBOARD-01 Onda 2 (Opcao C) -- correcao de identidade da loja "Bar da Sogra" -> "Aquarios Bar".
// O identificador comercial correto e "Aquarios Bar" (dono confirmou 2026-08-21). A loja nunca operou de
// verdade (0 orders/customers/products/categories, DNS nunca resolveu) -- renomear e seguro, auditado
// antes de executar: as 16 FKs do schema que apontam pra `stores` usam todas store_id (uuid), nenhuma usa
// slug; `slug` so tem UNIQUE, sem CHECK de formato na coluna (validado manualmente aqui, mesma regra que
// provision_store aplica: ^[a-z0-9]+(-[a-z0-9]+)*$, 2-40 chars). Transacional -- BEGIN...COMMIT, tudo ou
// nada. Pre-check/pos-check impressos pra auditoria; ROLLBACK documentado no rodape deste arquivo.
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

const STORE_ID = '776a01c8-f836-417a-a957-a0e1109f90a2';
const ENCANTO_ID = '8604324d-0529-443d-aa79-4337057bfa01';
const NOVO = {
  slug: 'aquariosbar',
  nome: 'Aquarios Bar',
  dominio: 'aquariosbar.lojas.valionsistemas.com.br',
  nomeCompleto: 'Aquarios Bar',
  nomeCurto: 'Aquarios',
};

let pass = 0, fail = 0;
const check = (nome, cond, detalhe = '') => {
  if (cond) { pass++; console.log(`  [PASS] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
  else { fail++; console.log(`  [FAIL] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
};

async function main() {
  await client.connect();

  console.log('===== PRE-CHECK =====');
  const antes = await client.query('SELECT id, slug, nome, dominio, status FROM public.stores WHERE id=$1', [STORE_ID]);
  check('store existe com o UUID esperado', antes.rows[0]?.id === STORE_ID, JSON.stringify(antes.rows[0]));
  const antesCompanyInfo = await client.query(`SELECT valor FROM public.store_settings WHERE store_id=$1 AND chave='company_info'`, [STORE_ID]);
  console.log('  company_info antes:', antesCompanyInfo.rows[0]?.valor);

  const livre = await client.query(`SELECT count(*)::int AS n FROM public.stores WHERE slug=$1 OR dominio=$2`, [NOVO.slug, NOVO.dominio]);
  check('"aquariosbar" (slug e dominio) continua livre', livre.rows[0].n === 0, `n=${livre.rows[0].n}`);

  check('novo slug passa no mesmo formato exigido por provision_store', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(NOVO.slug) && NOVO.slug.length >= 2 && NOVO.slug.length <= 40);

  if (fail > 0) {
    console.log('\nABORTADO: pre-check falhou, nenhuma alteracao feita.');
    await client.end();
    process.exit(1);
  }

  console.log('\n===== APLICANDO (transacional) =====');
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE public.stores SET slug=$1, nome=$2, dominio=$3 WHERE id=$4`,
      [NOVO.slug, NOVO.nome, NOVO.dominio, STORE_ID]
    );
    const novoCompanyInfo = { ...JSON.parse(antesCompanyInfo.rows[0].valor), nomeCompleto: NOVO.nomeCompleto, nomeCurto: NOVO.nomeCurto };
    await client.query(
      `UPDATE public.store_settings SET valor=$1 WHERE store_id=$2 AND chave='company_info'`,
      [JSON.stringify(novoCompanyInfo), STORE_ID]
    );
    await client.query('COMMIT');
    console.log('  COMMIT ok.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('  ERRO, ROLLBACK aplicado:', e.message);
    await client.end();
    process.exit(1);
  }

  console.log('\n===== POS-CHECK =====');
  const depois = await client.query('SELECT slug, nome, dominio FROM public.stores WHERE id=$1', [STORE_ID]);
  check('slug atualizado', depois.rows[0].slug === NOVO.slug, depois.rows[0].slug);
  check('nome atualizado', depois.rows[0].nome === NOVO.nome, depois.rows[0].nome);
  check('dominio atualizado', depois.rows[0].dominio === NOVO.dominio, depois.rows[0].dominio);

  const depoisCompanyInfo = await client.query(`SELECT valor FROM public.store_settings WHERE store_id=$1 AND chave='company_info'`, [STORE_ID]);
  const ci = JSON.parse(depoisCompanyInfo.rows[0].valor);
  check('company_info.nomeCompleto atualizado', ci.nomeCompleto === NOVO.nomeCompleto, ci.nomeCompleto);
  check('company_info.nomeCurto atualizado', ci.nomeCurto === NOVO.nomeCurto, ci.nomeCurto);
  check('company_info: demais campos preservados (telefone/whatsapp/email/cores)', ci.telefone === '' && ci.whatsapp === '' && ci.corPrimaria === '#6B7280');

  const rGetDomain = await client.query(`SELECT store_id FROM public.get_store_by_domain($1)`, [NOVO.dominio]);
  check('get_store_by_domain(aquariosbar.lojas...) resolve o store_id correto', rGetDomain.rows[0]?.store_id === STORE_ID, rGetDomain.rows[0]?.store_id);
  const rGetDomainVelho = await client.query(`SELECT store_id FROM public.get_store_by_domain($1)`, ['bar-da-sogra.lojas.valionsistemas.com.br']);
  const defaultId = (await client.query(`SELECT public.default_store_id() AS id`)).rows[0].id;
  check('get_store_by_domain(bar-da-sogra.lojas... -- slug antigo) NAO resolve mais esta loja (cai no default)', rGetDomainVelho.rows[0]?.store_id === defaultId, rGetDomainVelho.rows[0]?.store_id);

  // set_config(..., true) e' LOCAL a transacao -- precisa do MESMO BEGIN/COMMIT que o SELECT seguinte,
  // senao a GUC nao sobrevive entre statements (autocommit implicito de cada query separada).
  await client.query('BEGIN');
  await client.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ origin: `https://${NOVO.dominio}` })]);
  const rOrigin = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
  await client.query('COMMIT');
  check('resolve_store_from_origin(Origin=aquariosbar.lojas...) resolve o store_id correto', rOrigin.rows[0].id === STORE_ID, rOrigin.rows[0].id);

  const encantoIntacta = await client.query('SELECT slug, nome, dominio FROM public.stores WHERE id=$1', [ENCANTO_ID]);
  check('Encanto intacta (nao afetada)', encantoIntacta.rows[0].slug === 'encanto' && encantoIntacta.rows[0].dominio === 'encanto.valionsistemas.com.br', JSON.stringify(encantoIntacta.rows[0]));

  const totalLojas = await client.query('SELECT count(*)::int AS n FROM public.stores');
  check('nenhuma loja criada/removida (so 1 linha alterada)', totalLojas.rows[0].n >= 2, `total=${totalLojas.rows[0].n}`);

  const admins = await client.query('SELECT user_id FROM public.admins WHERE store_id=$1', [STORE_ID]);
  check('vinculo do admin real preservado (baraquarios806@gmail.com)', admins.rows.some(r => r.user_id === 'f4c21e4c-e7cf-4172-9a6d-cf6aab08705a'));

  console.log(`\n${'='.repeat(60)}\n RESULTADO: ${pass} passes, ${fail} failures\n${'='.repeat(60)}`);
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error('ERRO FATAL:', e.message); try { await client.query('ROLLBACK'); } catch {} await client.end(); process.exit(1); });

/* ROLLBACK manual, se necessario -- restaura exatamente o estado anterior capturado no pre-check desta
   execucao (2026-08-21):
     UPDATE public.stores SET slug='bar-da-sogra', nome='Bar da Sogra',
       dominio='bar-da-sogra.lojas.valionsistemas.com.br' WHERE id='776a01c8-f836-417a-a957-a0e1109f90a2';
     UPDATE public.store_settings SET valor = jsonb_set(jsonb_set(valor::jsonb,
       '{nomeCompleto}', '"Bar da Sogra"'), '{nomeCurto}', '"Bar"')::text
       WHERE store_id='776a01c8-f836-417a-a957-a0e1109f90a2' AND chave='company_info';
*/
