/* tests/admin-catalog.guard.mjs — REF-ADMIN-CATALOG-01. Roda: node tests/admin-catalog.guard.mjs (npm run test:admin-catalog)
   GUARDA ESTRUTURAL da governanca do catalogo. Analise estatica pura (sem banco/rede). Garante que:
     (1) o Admin ESCREVE categoria_ids (multi-categoria) — nao so o categoria_id unico;
     (2) o toggle Destaque e ligado a categoria "Destaques" (destaquesId) e o destaque fica em SINCRONIA
         com pertencer a ela (fim do boolean solto que a loja ignorava);
     (3) o Admin controla a ORDEM de exibicao;
     (4) a migracao adiciona categoria_ids, faz backfill e consolida os duplicados repontando order_items;
     (5) NAO foi criada arquitetura paralela: a migracao NAO usa as colunas dormentes de vitrine/promo
         (categories.tipo/estrategia/definicao/starts_at/ends_at) nem a tabela vazia product_collections;
     (6) a loja continua lendo por prodInCat (a arquitetura de leitura multi-categoria foi preservada);
     (7) DataService NAO remove categoria_ids do payload de escrita. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (f) => readFileSync(SRC + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const admin = strip(read('components/admin/AdminProducts.jsx'));
const store = strip(read('pages/StoreApp.jsx'));
const ds = strip(read('services/DataService.js'));
const mig = readFileSync(ROOT + 'migrations/REF-ADMIN-CATALOG-01-catalog.sql', 'utf8');
const migCode = mig.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');   // SQL sem comentarios (so DML)

/* (1) Admin escreve categoria_ids */
check('(1) AdminProducts compoe e escreve categoria_ids (multi-categoria)', () => {
  assert.ok(/categoria_ids:\s*catIds/.test(admin), 'o payload de save deve incluir categoria_ids');
  assert.ok(/new Set\(/.test(admin), 'deve deduplicar as categorias (Set)');
  assert.ok(/categoria_extras/.test(admin), 'deve haver controle de categorias extras');
});

/* (2) Destaque ligado a categoria Destaques + destaque sincronizado */
check('(2) Destaque ligado a categoria Destaques (destaquesId) e sincronizado', () => {
  assert.ok(/destaquesId\s*=\s*cats\.find/.test(admin), 'resolve a categoria Destaques por nome');
  assert.ok(/includes\('destaque'\)/.test(admin), 'heuristica por nome (includes destaque)');
  assert.ok(/catIds\s*=\s*catIds\.filter\(id\s*=>\s*id\s*!==\s*destaquesId\)/.test(admin), 'toggle e a UNICA via de c8 (remove antes de re-adicionar) -> desmarcar sempre tira da vitrine');
  assert.ok(/if\s*\(\s*form\.destaque\s*\)\s*catIds\.push\(destaquesId\)/.test(admin), 'destaque marcado -> entra em categoria_ids');
  assert.ok(/destaque:\s*isDestaque/.test(admin), 'destaque persistido = pertencer a Destaques (sincronia)');
  assert.ok(/cats\.filter\(c=>c\.id!==destaquesId\)/.test(admin), 'Destaques nunca e categoria PRINCIPAL (fora do dropdown)');
});

/* (3) Ordem controlavel */
check('(3) AdminProducts controla a ordem de exibicao', () => {
  assert.ok(/ordem:\s*Number/.test(admin), 'save persiste ordem');
  assert.ok(/f,ordem:e\.target\.value|ordem:\s*e\.target\.value/.test(admin), 'ha input de ordem');
});

/* (4) Migracao: coluna + backfill + consolidacao repontando order_items */
check('(4) migracao adiciona categoria_ids, backfill e consolida (repoint order_items)', () => {
  assert.ok(/add column if not exists categoria_ids text\[\]/i.test(mig), 'adiciona coluna categoria_ids text[]');
  assert.ok(/set categoria_ids = array\[categoria_id\]/i.test(mig), 'backfill = [categoria_id]');
  assert.ok(/update public\.order_items set product_id/i.test(mig), 'reponta order_items (preserva historico)');
  assert.ok(/delete from public\.products/i.test(migCode), 'remove as linhas duplicadas');
  assert.ok(/array\['c4','c8'\]/.test(migCode), 'Encanto Mineiro vira multi-categoria {c4,c8}');
  assert.ok(/where\s+destaque\s+is\s+true/i.test(migCode), 'RECONCILIA o flag legado destaque=true -> entra na vitrine c8');
});

/* (5) SEM arquitetura paralela: nao mexe nas colunas dormentes nem no product_collections (checa DML, sem comentarios) */
check('(5) nao cria arquitetura paralela (sem tipo/estrategia/definicao/product_collections)', () => {
  assert.ok(!/product_collections/i.test(migCode), 'nao usa a tabela vazia product_collections');
  assert.ok(!/estrategia|definicao|starts_at|ends_at/i.test(migCode), 'nao usa as colunas dormentes de promo/vitrine');
});

/* (6) Loja preserva a leitura por prodInCat */
check('(6) a loja renderiza por prodInCat (leitura multi-categoria preservada)', () => {
  assert.ok(/prodInCat\(/.test(store), 'StoreApp filtra secoes por prodInCat');
});

/* (7) DataService nao descarta categoria_ids */
check('(7) DataService.upsertProd nao remove categoria_ids (persiste o payload)', () => {
  assert.ok(!/delete\s+payload\.categoria_ids/.test(ds), 'upsertProd nao pode deletar categoria_ids do payload');
  assert.ok(/upsertProd/.test(ds), 'upsertProd existe');
});

console.log(fail === 0
  ? '\nOK admin-catalog.guard — Admin controla categoria_ids/destaque/ordem; migracao unica (sem arq. paralela)'
  : `\nFALHA admin-catalog.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
