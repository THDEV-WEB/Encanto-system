/* scripts/norm05-verify.mjs — NORM-05 · roda com:  npm run verify:norm05
   Guard de banco PÓS-migração (toca o banco; lê creds de C:\Users\00thi\.encanto\db.env, NUNCA imprime senha).
   Valida:
   (1) SCHEMA GUARD — CHECK vigente contém os 7 grupos; coluna subgrupo_label existe; colunas obrigatórias do domínio presentes.
   (2) EQUIVALÊNCIA BANCO × LEGADO — as 20 linhas migradas (aplica IS NULL) batem MOCK_ADS em nome/grupo/tipo/preco/subgrupo_label.
   (3) RESOLVER SMOKE — pool do banco: c3→15, não-c3 açaí→15 acai, marmita→5 (resolver real).
   (4) SNAPSHOT SQL — escreve docs/norm05-db-snapshot.md (total, por grupo, por aplica, por tipo, CHECK) p/ congelar o estado.
   Diferente dos golden (puros), este NÃO entra no test:addons — é o guard de schema/equivalência do banco. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { MOCK_ADS, CAT_ADDON_GROUP, resolverAdicionais } from '../src/utils/addons.js';
/* pg vive no runner local (.encanto/node_modules), não nas deps do frontend — resolve de lá. */
const pg = createRequire('C:\\Users\\00thi\\.encanto\\package.json')('pg');

const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.env';
const envGet = (txt,k)=>{const m=txt.match(new RegExp('^\\s*'+k+'\\s*=\\s*(.+?)\\s*$','m'));return m?m[1].trim().replace(/^["']|["']$/g,''):null;};
function loadConn(){ const txt=readFileSync(ENV_PATH,'utf8'); const host=envGet(txt,'PGHOST');
  if(host){const password=envGet(txt,'PGPASSWORD'); return {cfg:{host,port:Number(envGet(txt,'PGPORT')||5432),user:envGet(txt,'PGUSER'),password,database:envGet(txt,'PGDATABASE')||'postgres'},secret:password};}
  const url=envGet(txt,'SUPABASE_DB_URL'); return {cfg:{connectionString:url},secret:url}; }

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ✓ ' + m); } catch (e) { fail++; console.error('  ✗ ' + m + ' — ' + (e?.message ?? e)); } };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const { cfg, secret } = loadConn();
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl:{rejectUnauthorized:false}, statement_timeout:60000, connectionTimeoutMillis:15000 });

const t0 = performance.now();
const pad = k => (k + ' ').padEnd(22, '.');
try {
  await client.connect();
  const rows = (await client.query('select id,nome,grupo,tipo,preco::float8 preco,ativo,ordem,aplica_categoria_id,subgrupo_label from public.adicionais')).rows;
  console.error('— RELATÓRIO REPRODUZÍVEL');
  console.error('  ' + pad('Node') + ' ' + process.version);
  console.error('  ' + pad('Platform') + ' ' + process.platform);
  console.error('  ' + pad('Architecture') + ' ' + process.arch);
  console.error('  ' + pad('Generated') + ' ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
  console.error('  ' + pad('Linhas analisadas') + ' ' + rows.length);
  console.error('  ' + pad('Categorias (resolver)') + ' ' + Object.keys(CAT_ADDON_GROUP).length);
  const cols = (await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='adicionais'")).rows.map(r=>r.column_name);
  const checkDef = (await client.query("select pg_get_constraintdef(oid) def from pg_constraint where conname='adicionais_grupo_check'")).rows[0]?.def || '';

  console.error('— (1) SCHEMA GUARD');
  for (const g of ['simples','premium','frutas_premium','chocolates','acai','marmita','bebida'])
    check(`CHECK permite '${g}'`, ()=>assert(checkDef.includes(`'${g}'`), `CHECK não contém ${g}: ${checkDef}`));
  check('coluna subgrupo_label existe', ()=>assert(cols.includes('subgrupo_label'), 'falta subgrupo_label'));
  for (const c of ['grupo','aplica_categoria_id','ordem','tipo','preco','nome','ativo'])
    check(`coluna obrigatória '${c}'`, ()=>assert(cols.includes(c), `falta ${c}`));

  console.error('— (2) EQUIVALÊNCIA BANCO × LEGADO (migrados aplica IS NULL ≡ MOCK_ADS)');
  const migrados = rows.filter(r => r.aplica_categoria_id === null);
  check('qtd migrados = MOCK_ADS', ()=>eq(migrados.length, MOCK_ADS.length, 'qtd'));
  const byKey = new Map(migrados.map(r => [r.nome + '|' + r.grupo, r]));
  for (const m of MOCK_ADS) {
    check(`legado→banco: ${m.nome} (${m.grupo})`, ()=>{
      const db = byKey.get(m.nome + '|' + m.grupo);
      assert(db, `sem linha migrada p/ ${m.nome}|${m.grupo}`);
      eq(db.tipo, m.tipo, 'tipo');
      eq(Number(db.preco), Number(m.preco), 'preco');
      eq(db.subgrupo_label ?? null, m.subgrupo_label ?? null, 'subgrupo_label');
    });
  }

  console.error('— (3) RESOLVER SMOKE (pool do banco)');
  const pool = rows.map(r => ({ ...r, preco: Number(r.preco) }));
  const idsLen = (prod) => resolverAdicionais(pool, prod).length;
  check('c3 (grupos_ad reais) → 15', ()=>eq(idsLen({categoria_id:'c3', grupos_ad:['simples','premium','frutas_premium','chocolates']}), 15, 'c3'));
  check('c4 (acai) → 15', ()=>eq(idsLen({categoria_id:'c4', grupos_ad:null}), 15, 'c4'));
  check('c5 (marmita) → 5', ()=>eq(idsLen({categoria_id:'c5', grupos_ad:null}), 5, 'c5'));

  console.error('— (4) SNAPSHOT SQL → docs/norm05-db-snapshot.md');
  const grp = {}, cat = {}, tip = {};
  for (const r of rows) { grp[r.grupo]=(grp[r.grupo]||0)+1; const k=r.aplica_categoria_id??'(null=todas)'; cat[k]=(cat[k]||0)+1; tip[r.tipo]=(tip[r.tipo]||0)+1; }
  const tbl = o => Object.keys(o).sort().map(k=>`- ${k}: ${o[k]}`).join('\n');
  const snap = `# NORM-05 — Snapshot do banco (public.adicionais)\n\nCongelado após a migração de fonte única. Qualquer alteração futura no schema/dados fica evidente no diff deste arquivo.\n\n- **Total de registros:** ${rows.length}\n\n## Por grupo\n${tbl(grp)}\n\n## Por aplica_categoria_id\n${tbl(cat)}\n\n## Por tipo\n${tbl(tip)}\n\n## CHECK vigente (grupo)\n\`\`\`\n${checkDef}\n\`\`\`\n`;
  writeFileSync(new URL('../docs/norm05-db-snapshot.md', import.meta.url), snap, 'utf8');
  check('snapshot SQL escrito', ()=>assert(rows.length === 35, `esperava 35 registros, achou ${rows.length}`));

  console.error('  ' + pad('Tempo total') + ' ' + (performance.now() - t0).toFixed(2) + ' ms');
  console.log(fail===0 ? '\n✅ verify:norm05 OK — schema + equivalência banco×legado + resolver + snapshot' : `\n❌ ${fail} falha(s)`);
} catch (e) { console.error('VERIFY ERROR: ' + redact(e?.message ?? e)); fail++; }
finally { await client.end().catch(()=>{}); }
process.exit(fail===0 ? 0 : 1);
