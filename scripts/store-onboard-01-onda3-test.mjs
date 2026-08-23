// scripts/store-onboard-01-onda3-test.mjs — REF-STORE-ONBOARD-01 · Onda 3 (P2/P3/P1).
// Camada A (estrutural: grants) + Camada B (comportamental, BEGIN...ROLLBACK, lojas/categorias/produtos
// FICTICIOS -- nunca toca Encanto/Aquarios Bar reais). Cada chamada de RPC roda dentro de um SAVEPOINT
// proprio -- uma RAISE EXCEPTION esperada (caso negativo) so desfaz ATE o savepoint, nunca aborta a
// transacao inteira (bug corrigido nesta mesma suite antes da 1a execucao real). P2 (checagem HTTPS ao
// vivo no Platform Console) e' so' frontend -- validado por build + inspecao do bundle, nao por SQL.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const envTxt = readFileSync('C:/Users/00thi/.encanto/db.env', 'utf8');
const get = (k) => { const m = envTxt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim() : null; };
const client = new pg.Client({
  host: get('PGHOST'), port: Number(get('PGPORT') || 5432), user: get('PGUSER'),
  password: get('PGPASSWORD'), database: get('PGDATABASE') || 'postgres',
  ssl: { rejectUnauthorized: false }, statement_timeout: 20000, connectionTimeoutMillis: 15000,
});

const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // super admin real (mesmo usado nas suites anteriores desta REF)
const STRANGER_USER_ID = '11111111-1111-4111-8111-111111111199'; // qualquer uuid autenticado, nunca super admin

let pass = 0, fail = 0;
const out = (s) => console.log(s);
const check = (nome, cond, detalhe = '') => {
  if (cond) { pass++; out(`  [PASS] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
  else { fail++; out(`  [FAIL] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
};

let spCounter = 0;
// Roda 1 chamada de RPC dentro do proprio SAVEPOINT, como um usuario especifico (ou 'anon'). Sucesso ->
// RELEASE + RESET ROLE (volta pro superuser da conexao, pra leituras diretas seguintes nao herdar o
// papel/claims). Erro -> ROLLBACK TO SAVEPOINT (desfaz so' esta chamada, ja volta o papel sozinho -- SET
// LOCAL e' desfeito junto pelo rollback do savepoint).
async function chamar(userId, sql, params = []) {
  const sp = `sp_${++spCounter}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    if (userId === 'anon') {
      await client.query('SET LOCAL ROLE anon');
    } else {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
      await client.query('SET LOCAL ROLE authenticated');
    }
    const r = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    await client.query('RESET ROLE');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return { ok: false, error: e.message };
  }
}

async function main() {
  await client.connect();

  out('\n=== Camada A: grants das 2 RPCs novas (authenticated sim, anon nao) ===');
  for (const fn of ['platform_set_store_dominio', 'platform_clone_catalog']) {
    const r = await client.query(`
      SELECT r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') AS pode
      FROM pg_proc p CROSS JOIN pg_roles r
      WHERE p.proname=$1 AND p.pronamespace='public'::regnamespace AND r.rolname IN ('anon','authenticated')`, [fn]);
    const mapa = Object.fromEntries(r.rows.map(x => [x.rolname, x.pode]));
    check(`A: ${fn} -- authenticated=true, anon=false`, mapa.authenticated === true && mapa.anon === false, JSON.stringify(mapa));
  }

  out('\n=== Camada B: platform_set_store_dominio -- BEGIN...ROLLBACK, loja ficticia ===');
  await client.query('BEGIN');
  try {
    const LOJA_A = '99999999-9999-4999-8999-000000000301';
    const LOJA_B = '99999999-9999-4999-8999-000000000302';
    await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES
      ($1,'onda3-dominio-a','Onda3 Dominio A', NULL, 'ativo'),
      ($2,'onda3-dominio-b','Onda3 Dominio B','onda3-b-ja-usado.com.br','ativo')`, [LOJA_A, LOJA_B]);

    // B1: stranger (autenticado, nao super admin) -- negado
    {
      const r = await chamar(STRANGER_USER_ID, `SELECT public.platform_set_store_dominio($1,$2)`, [LOJA_A, 'x.com.br']);
      check('B1: stranger autenticado -- negado (42501)', !r.ok && /apenas o super admin/.test(r.error), r.error);
    }

    // B2: super admin, dominio valido -- aplica
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_set_store_dominio($1,$2) AS r`, [LOJA_A, 'ONDA3-TESTE.com.BR']);
      check('B2: super admin, dominio valido -- aplicado (lowercased)', r.ok && r.rows[0].r.dominio === 'onda3-teste.com.br', JSON.stringify(r));
      const conf = await client.query('SELECT dominio FROM public.stores WHERE id=$1', [LOJA_A]);
      check('B2: persistiu de verdade em stores', conf.rows[0].dominio === 'onda3-teste.com.br', conf.rows[0].dominio);
    }

    // B3: super admin, dominio invalido -- rejeitado
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_set_store_dominio($1,$2)`, [LOJA_A, 'nao e um dominio!!']);
      check('B3: dominio com formato invalido -- rejeitado', !r.ok && /dominio invalido/.test(r.error), r.error);
    }

    // B4: super admin, dominio ja usado por OUTRA loja (LOJA_B) -- rejeitado (unique_violation traduzido)
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_set_store_dominio($1,$2)`, [LOJA_A, 'onda3-b-ja-usado.com.br']);
      check('B4: dominio ja usado por outra loja -- rejeitado (anti-takeover)', !r.ok && /ja esta em uso/.test(r.error), r.error);
      const conf = await client.query('SELECT dominio FROM public.stores WHERE id=$1', [LOJA_A]);
      check('B4: LOJA_A continua com o dominio anterior (rejeicao nao mutou nada)', conf.rows[0].dominio === 'onda3-teste.com.br', conf.rows[0].dominio);
    }

    // B5: super admin, vazio -- limpa (volta pra NULL)
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_set_store_dominio($1,$2) AS r`, [LOJA_A, '']);
      check('B5: dominio vazio -- limpa pra NULL', r.ok && r.rows[0].r.dominio === null, JSON.stringify(r));
    }

    // B6: loja inexistente -- rejeitado
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_set_store_dominio($1,$2)`, ['11111111-1111-4111-8111-111111111111', 'x.com.br']);
      check('B6: store_id inexistente -- rejeitado', !r.ok && /loja nao encontrada/.test(r.error), r.error);
    }
  } finally {
    await client.query('ROLLBACK');
  }
  {
    const residuo = await client.query(`SELECT count(*)::int AS n FROM public.stores WHERE slug IN ('onda3-dominio-a','onda3-dominio-b')`);
    check('B1-B6: mutacao liquida = 0 apos ROLLBACK', residuo.rows[0].n === 0, `n=${residuo.rows[0].n}`);
  }

  out('\n=== Camada B: platform_clone_catalog -- BEGIN...ROLLBACK, lojas/catalogo ficticios ===');
  await client.query('BEGIN');
  try {
    const ORIGEM = '99999999-9999-4999-8999-000000000401';
    const DESTINO_VAZIO = '99999999-9999-4999-8999-000000000402';
    const DESTINO_CHEIO = '99999999-9999-4999-8999-000000000403';
    const CAT1 = 'onda3-cat-bebidas';
    const CAT2 = 'onda3-cat-comidas';
    const CAT3 = 'onda3-cat-destaques'; // tipo='collection' -- alvo valido de product_collections.collection_id (trigger STI I1)
    const PROD1 = '99999999-9999-4999-8999-000000000411';
    const PROD2 = '99999999-9999-4999-8999-000000000412';

    await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES
      ($1,'onda3-clone-origem','Onda3 Clone Origem', NULL, 'ativo'),
      ($2,'onda3-clone-destino-vazio','Onda3 Clone Destino Vazio', NULL, 'ativo'),
      ($3,'onda3-clone-destino-cheio','Onda3 Clone Destino Cheio', NULL, 'ativo')`, [ORIGEM, DESTINO_VAZIO, DESTINO_CHEIO]);

    // tipo='business' exige estrategia/definicao/starts_at/ends_at NULOS (categories_sti_coll_chk);
    // tipo='collection' exige estrategia NAO NULA (categories_sti_biz_chk) -- CAT3 cobre esse caso tb,
    // pra provar que a clonagem preserva tipo/estrategia corretamente nos dois formatos.
    await client.query(`INSERT INTO public.categories (id, nome, slug, tipo, ordem, ativo, store_id) VALUES
      ($1,'Bebidas','bebidas','business',1,true,$3),
      ($2,'Comidas','comidas','business',2,true,$3)`, [CAT1, CAT2, ORIGEM]);
    await client.query(`INSERT INTO public.categories (id, nome, slug, tipo, estrategia, ordem, ativo, store_id) VALUES
      ($1,'Destaques','destaques','collection','manual',3,true,$2)`, [CAT3, ORIGEM]);

    await client.query(`INSERT INTO public.products (id, nome, descricao, preco, categoria_id, categoria_ids, disponivel, grupos_ad, store_id) VALUES
      ($1,'Suco de Laranja','fresquinho',8.5,$3,ARRAY[$3,$4],true,ARRAY['simples'],$5),
      ($2,'Marmita P','arroz+feijao+carne',22.0,$4,ARRAY[$4],true,ARRAY['marmita'],$5)`,
      [PROD1, PROD2, CAT1, CAT2, ORIGEM]);

    await client.query(`INSERT INTO public.adicionais (nome, grupo, tipo, preco, ativo, ordem, aplica_categoria_id, store_id) VALUES
      ('Gelo extra','simples','gratis',0,true,1,$1,$2),
      ('Bacon','marmita','pago',4.0,true,1,$3,$2)`, [CAT1, ORIGEM, CAT2]);

    await client.query(`INSERT INTO public.product_collections (product_id, collection_id, ordem, fixado, store_id) VALUES
      ($1,$2,1,false,$3)`, [PROD1, CAT3, ORIGEM]);

    // catalogo "cheio" no destino B, pra provar a guarda anti-merge
    await client.query(`INSERT INTO public.categories (id, nome, slug, tipo, ordem, ativo, store_id) VALUES
      ('onda3-cat-ja-existe','Ja Existe','ja-existe','business',1,true,$1)`, [DESTINO_CHEIO]);

    // C1: stranger -- negado
    {
      const r = await chamar(STRANGER_USER_ID, `SELECT public.platform_clone_catalog($1,$2)`, [ORIGEM, DESTINO_VAZIO]);
      check('C1: stranger autenticado -- negado (42501)', !r.ok && /apenas o super admin/.test(r.error), r.error);
    }

    // C2: origem == destino -- rejeitado
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_clone_catalog($1,$1)`, [ORIGEM]);
      check('C2: origem == destino -- rejeitado', !r.ok && /nao podem ser a mesma/.test(r.error), r.error);
    }

    // C3: destino ja tem catalogo proprio -- rejeitado (guarda anti-merge)
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_clone_catalog($1,$2)`, [ORIGEM, DESTINO_CHEIO]);
      check('C3: destino com catalogo proprio -- rejeitado', !r.ok && /ja tem catalogo proprio/.test(r.error), r.error);
    }

    // C4: loja inexistente -- rejeitado
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_clone_catalog($1,$2)`, ['11111111-1111-4111-8111-111111111111', DESTINO_VAZIO]);
      check('C4: loja de origem inexistente -- rejeitado', !r.ok && /nao encontrada/.test(r.error), r.error);
    }

    // C5: clonagem real -- sucesso, com todas as garantias de integridade
    let novoIdCat3, novoIdProd1;
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_clone_catalog($1,$2) AS r`, [ORIGEM, DESTINO_VAZIO]);
      check('C5: clonagem retornou sucesso', r.ok, r.error);
      const res = r.rows?.[0]?.r ?? {};
      check('C5: retorno reporta 3 categorias, 2 produtos, 2 adicionais, 1 colecao', res.categorias === 3 && res.produtos === 2 && res.adicionais === 2 && res.colecoes === 1, JSON.stringify(res));
    }
    {
      const cats = await client.query('SELECT id, nome, tipo, estrategia, store_id FROM public.categories WHERE store_id=$1 ORDER BY nome', [DESTINO_VAZIO]);
      check('C5: 3 categorias clonadas no destino', cats.rows.length === 3, JSON.stringify(cats.rows.map(r=>r.nome)));
      check('C5: ids das categorias clonadas sao NOVOS (nunca reusa id da origem)', cats.rows.every(r => r.id !== CAT1 && r.id !== CAT2 && r.id !== CAT3), JSON.stringify(cats.rows.map(r=>r.id)));
      const destaques = cats.rows.find(r => r.nome === 'Destaques');
      check('C5: categoria tipo=collection preserva tipo/estrategia na clonagem', destaques?.tipo === 'collection' && destaques?.estrategia === 'manual', JSON.stringify(destaques));
      novoIdCat3 = destaques?.id;

      const prods = await client.query('SELECT id, nome, categoria_id, categoria_ids, disponivel, store_id FROM public.products WHERE store_id=$1 ORDER BY nome', [DESTINO_VAZIO]);
      check('C5: 2 produtos clonados no destino', prods.rows.length === 2, JSON.stringify(prods.rows.map(r=>r.nome)));
      check('C5: ids dos produtos clonados sao NOVOS', prods.rows.every(r => r.id !== PROD1 && r.id !== PROD2));
      check('C5: TODOS os produtos clonados nascem disponivel=false (seed neutro)', prods.rows.every(r => r.disponivel === false), JSON.stringify(prods.rows.map(r=>r.disponivel)));
      const suco = prods.rows.find(r => r.nome === 'Suco de Laranja');
      novoIdProd1 = suco?.id;
      check('C5: categoria_id do produto clonado NAO aponta mais pra categoria da origem', !!suco && suco.categoria_id !== CAT1 && cats.rows.some(c => c.id === suco.categoria_id), suco?.categoria_id);
      check('C5: categoria_ids (array) remapeado, sem nenhum id da origem sobrando', !!suco && Array.isArray(suco.categoria_ids) && !suco.categoria_ids.includes(CAT1) && !suco.categoria_ids.includes(CAT2), JSON.stringify(suco?.categoria_ids));

      const ads = await client.query('SELECT nome, aplica_categoria_id, store_id FROM public.adicionais WHERE store_id=$1 ORDER BY nome', [DESTINO_VAZIO]);
      check('C5: 2 adicionais clonados no destino', ads.rows.length === 2, JSON.stringify(ads.rows.map(r=>r.nome)));
      check('C5: aplica_categoria_id dos adicionais remapeado (nunca aponta pra categoria da origem)', ads.rows.every(r => r.aplica_categoria_id !== CAT1 && r.aplica_categoria_id !== CAT2));

      const pcs = await client.query('SELECT product_id, collection_id, store_id FROM public.product_collections WHERE store_id=$1', [DESTINO_VAZIO]);
      check('C5: 1 vinculo de colecao clonado', pcs.rows.length === 1, JSON.stringify(pcs.rows));
      check('C5: vinculo de colecao remapeado (product_id e collection_id sao os NOVOS ids)', pcs.rows[0]?.product_id === novoIdProd1 && pcs.rows[0]?.collection_id === novoIdCat3, JSON.stringify({ pcs: pcs.rows[0], novoIdProd1, novoIdCat3 }));
    }
    {
      // origem intacta -- clonagem nunca deveria alterar a loja de origem
      const origemDepois = await client.query('SELECT count(*)::int AS n FROM public.categories WHERE store_id=$1', [ORIGEM]);
      check('C5: loja de origem continua com suas 3 categorias (nao foi alterada)', origemDepois.rows[0].n === 3, origemDepois.rows[0].n);
    }

    // C6: clonar de novo pro MESMO destino agora que ele deixou de estar vazio -- rejeitado
    {
      const r = await chamar(ADMIN_REAL_USER_ID, `SELECT public.platform_clone_catalog($1,$2)`, [ORIGEM, DESTINO_VAZIO]);
      check('C6: clonar de novo pro mesmo destino (agora nao-vazio) -- rejeitado (nunca duplica)', !r.ok && /ja tem catalogo proprio/.test(r.error), r.error);
    }
  } finally {
    await client.query('ROLLBACK');
  }
  {
    const residuo = await client.query(`SELECT count(*)::int AS n FROM public.stores WHERE slug LIKE 'onda3-clone-%'`);
    check('C1-C6: mutacao liquida = 0 apos ROLLBACK (nenhuma loja/categoria/produto ficticio sobrou)', residuo.rows[0].n === 0, `n=${residuo.rows[0].n}`);
  }

  out('\n=== P2 (frontend, checagem HTTPS ao vivo): confirmacao via bundle buildado ===');
  {
    const arquivos = readdirSync('C:/Projetos/Encanto/encanto-react/dist/assets').filter(f => f.startsWith('admin-') && f.endsWith('.js'));
    const conteudo = arquivos.map(f => readFileSync(`C:/Projetos/Encanto/encanto-react/dist/assets/${f}`, 'utf8')).join('\n');
    check('P2: bundle admin buildado contem a nova checagem no-cors (nao so string estatica)', conteudo.includes('no-cors'), `arquivos=${arquivos.join(',')}`);
    check('P2: bundle contem platform_set_store_dominio (P3 chegou no build)', conteudo.includes('platform_set_store_dominio'));
    check('P2: bundle contem platform_clone_catalog (P1 chegou no build)', conteudo.includes('platform_clone_catalog'));
  }

  out(`\n${'='.repeat(70)}\n RESULTADO: ${pass} passes, ${fail} failures\n${'='.repeat(70)}`);
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error('ERRO FATAL:', e.message, e.stack); try { await client.query('ROLLBACK'); } catch {} try { await client.end(); } catch {} process.exit(1); });
