/* tests/admin-addons.guard.mjs — REF-ADMIN-ADDONS-02. Roda: node tests/admin-addons.guard.mjs (npm run test:admin-addons)
   GUARDA ESTRUTURAL do controle "grupos de adicionais por produto". Analise estatica pura (sem banco/rede).
   Prova mecanicamente que a UI do Admin de produtos passou a CONFIGURAR products.grupos_ad reutilizando o campo
   ja existente e o dominio addons.js — sem migracao, sem duplicar regra de negocio, sem regressao. Garante que:
     (1) AdminProducts consome o dominio (gruposDoProduto) e carrega os adicionais (fonte dos grupos);
     (2) a lista de grupos e DINAMICA/ESCALAVEL — derivada dos adicionais aplicaveis a categoria (nao hardcoded);
     (3) o Admin ESCREVE grupos_ad no payload de save (array explicito);
     (4) ao editar, pre-marca os grupos EFETIVOS (gruposDoProduto) -> compatibilidade dos produtos antigos (null);
     (5) DataService.upsertProd NAO remove grupos_ad do payload (persiste tudo por spread);
     (6) o CONTRATO do dominio permanece: gruposDoProduto le prod.grupos_ad e resolverAdicionais deriva dele;
     (7) a loja resolve os adicionais do produto por resolverAdicionais (leitura por grupo preservada);
     (8) a tela de Adicionais NAO virou config por produto (nao le/escreve grupos_ad). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (f) => readFileSync(SRC + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const admin      = strip(read('components/admin/AdminProducts.jsx'));
const ds         = strip(read('services/DataService.js'));
const addons     = strip(read('utils/addons.js'));
const store      = strip(read('pages/StoreApp.jsx'));
const adicionais = strip(read('components/admin/AdminAdicionais.jsx'));

/* (1) Admin consome o dominio e carrega os adicionais */
check('(1) AdminProducts importa gruposDoProduto (dominio) e carrega os adicionais', () => {
  assert.ok(/import\s*\{[^}]*gruposDoProduto[^}]*\}\s*from\s*['"][^'"]*utils\/addons\.js['"]/.test(admin),
    'deve importar gruposDoProduto de utils/addons.js');
  assert.ok(/DS\.getAllAds\(\)/.test(admin), 'load() deve buscar os adicionais (fonte dos grupos)');
});

/* (2) Lista de grupos DINAMICA/ESCALAVEL (derivada dos dados, nao hardcoded) */
check('(2) grupos oferecidos derivam dos adicionais aplicaveis a categoria (dinamico)', () => {
  assert.ok(/gruposDisponiveis/.test(admin), 'deve existir a derivacao gruposDisponiveis');
  assert.ok(/aplica_categoria_id\s*===\s*catId/.test(admin), 'filtra por aplica_categoria_id (escopo por categoria)');
  assert.ok(/new Set\(/.test(admin), 'deduplica os grupos (Set)');
  assert.ok(/gruposDisponiveis\.map/.test(admin), 'renderiza o checklist a partir de gruposDisponiveis');
  assert.ok(/toggleGrupoAd/.test(admin), 'ha handler de selecao multipla por grupo');
});

/* (3) Admin ESCREVE grupos_ad no payload */
check('(3) AdminProducts.save escreve grupos_ad (array explicito) no payload', () => {
  assert.ok(/grupos_ad:\s*Array\.isArray\(form\.grupos_ad\)/.test(admin),
    'o objeto data do save deve incluir grupos_ad como array');
});

/* (4) Pre-marca os grupos EFETIVOS ao editar -> compatibilidade dos antigos (grupos_ad null -> fallback) */
check('(4) openEdit pre-marca grupos_ad = gruposDoProduto(p) (compat. antigos, sem regressao)', () => {
  assert.ok(/grupos_ad:\s*\[\s*\.\.\.gruposDoProduto\(p\)\s*\]/.test(admin),
    'ao editar, grupos_ad inicia com os grupos efetivos (copia do dominio)');
});

/* (5) DataService persiste grupos_ad (nao deleta do payload) */
check('(5) DataService.upsertProd persiste grupos_ad (nao remove do payload)', () => {
  assert.ok(/upsertProd/.test(ds), 'upsertProd existe');
  assert.ok(/const payload = \{\s*\.\.\.data\s*\}/.test(ds), 'upsertProd espalha o payload (persiste todos os campos)');
  assert.ok(!/delete\s+payload\.grupos_ad/.test(ds), 'upsertProd nao pode deletar grupos_ad do payload');
});

/* (6) Contrato do dominio preservado: le prod.grupos_ad e resolve por ele */
check('(6) dominio addons.js: gruposDoProduto le prod.grupos_ad e resolverAdicionais deriva dele', () => {
  assert.ok(/gruposDoProduto\s*=\s*prod\s*=>\s*prod\?\.grupos_ad/.test(addons),
    'gruposDoProduto continua lendo prod.grupos_ad como override por produto');
  assert.ok(/const grupos = gruposDoProduto\(prod\)/.test(addons),
    'resolverAdicionais deriva os grupos de gruposDoProduto');
});

/* (7) Loja resolve os adicionais do produto por resolverAdicionais (leitura por grupo preservada) */
check('(7) a loja resolve os adicionais do produto por resolverAdicionais', () => {
  assert.ok(/resolverAdicionais\(/.test(store), 'StoreApp resolve adicionais via resolverAdicionais (respeita grupos_ad)');
});

/* (8) A tela de Adicionais NAO virou config por produto (escopo intacto) */
check('(8) AdminAdicionais nao configura grupos_ad por produto (escopo preservado)', () => {
  assert.ok(!/grupos_ad/.test(adicionais), 'a tela de Adicionais nao deve ler/escrever grupos_ad (continua CRUD de adicional+grupo)');
});

console.log(fail === 0
  ? '\nOK admin-addons.guard — Admin configura grupos_ad por produto (dinamico, reutiliza o campo/dominio; sem regressao)'
  : `\nFALHA admin-addons.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
