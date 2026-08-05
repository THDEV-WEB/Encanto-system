/* tests/deliveryFee-admin.guard.mjs — REF-DELIVERY-FEE-01. Roda: node tests/deliveryFee-admin.guard.mjs
   GUARDA ESTRUTURAL da UI Admin da taxa de entrega. Analise estatica pura (sem banco/rede/React). Prova
   mecanicamente que:
     (1) AdminPanel registra a aba "Taxa de Entrega" e monta AdminTaxaEntrega;
     (2) AdminTaxaEntrega REAPROVEITA a validacao pura (deliveryFeeConfigForm) — nao reimplementa
         sobreposicao/duplicata/negativo na UI;
     (3) AdminTaxaEntrega REAPROVEITA a infraestrutura de mapa do dominio Address (mapService via barrel)
         — nao inicializa Leaflet nem chama nenhuma API de geocoding paga;
     (4) NENHUM valor de faixa/maquininha fica hardcoded no componente (a tabela padrao so existe na
         migration SQL e no fallback de resiliencia do IO, nunca na UI);
     (5) AdminPedidos exibe delivery_fee/maquininha_fee lendo o pedido (sem recalcular a regra de negocio -
         nenhum import de deliveryFeeRules ali). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (f) => readFileSync(SRC + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const panel = strip(read('components/admin/AdminPanel.jsx'));
const admin = strip(read('components/admin/AdminTaxaEntrega.jsx'));
const pedidos = strip(read('components/admin/AdminPedidos.jsx'));

/* (1) registro no painel */
check('(1) AdminPanel importa AdminTaxaEntrega e registra a aba "taxaentrega"', () => {
  assert.ok(/import\s*\{\s*AdminTaxaEntrega\s*\}\s*from\s*['"]\.\/AdminTaxaEntrega\.jsx['"]/.test(panel));
  assert.ok(/id:\s*'taxaentrega'/.test(panel), 'aba taxaentrega ausente do array tabs');
  assert.ok(/tab===\s*'taxaentrega'\s*&&\s*<AdminTaxaEntrega\s*\/>/.test(panel), 'renderizacao condicional ausente');
});

/* (2) reaproveita a validacao pura — nao reimplementa a regra de sobreposicao/duplicata na UI */
check('(2) AdminTaxaEntrega importa validarFaixas/paraPersistirFaixas/paraEditavel de deliveryFeeConfigForm.js', () => {
  assert.ok(/from\s*['"]\.\.\/\.\.\/services\/delivery\/deliveryFeeConfigForm\.js['"]/.test(admin));
  assert.ok(/validarFaixas/.test(admin) && /paraPersistirFaixas/.test(admin) && /paraEditavel/.test(admin));
});
check('(2b) AdminTaxaEntrega NAO reimplementa checagem de sobreposicao (sem "sobrepost" fora de import)', () => {
  assert.ok(!/sobrepost/i.test(admin), 'logica de sobreposicao deve morar so em deliveryFeeConfigForm.js/set_delivery_fee_config');
});

/* (3) reaproveita a infraestrutura de mapa (gratuita) do dominio Address — nunca uma API paga nova */
check('(3) AdminTaxaEntrega importa carregarLeaflet/criarMapa/destruirMapa do barrel address/index.js (reuso, sem CDN/serviço novo)', () => {
  assert.ok(/from\s*['"]\.\.\/\.\.\/address\/index\.js['"]/.test(admin));
  assert.ok(/carregarLeaflet/.test(admin) && /criarMapa/.test(admin) && /destruirMapa/.test(admin));
});
check('(3b) AdminTaxaEntrega nao referencia nenhuma API de mapa/geocoding paga (Google Maps Distance Matrix)', () => {
  assert.ok(!/googleapis|distancematrix|google\.maps/i.test(admin));
});

/* (4) nenhum valor de faixa/maquininha hardcoded na UI — tudo vem de useDeliveryFeeConfig/useCompanyInfo */
check('(4) AdminTaxaEntrega consome useDeliveryFeeConfig/useCompanyInfo — não declara a tabela padrão localmente', () => {
  assert.ok(/useDeliveryFeeConfig\(\)/.test(admin));
  assert.ok(/useCompanyInfo\(\)/.test(admin));
  assert.ok(!/10\.00|12\.00|42\.00/.test(admin), 'valores da tabela padrão não podem estar hardcoded no componente');
});

/* (5) AdminPedidos exibe os campos sem recalcular a regra (nunca importa deliveryFeeRules) */
check('(5) AdminPedidos exibe order.delivery_fee/order.maquininha_fee sem importar a regra de calculo', () => {
  assert.ok(/order\.delivery_fee/.test(pedidos) && /order\.maquininha_fee/.test(pedidos));
  assert.ok(!/deliveryFeeRules/.test(pedidos), 'AdminPedidos deve so EXIBIR os campos persistidos, nunca recalcular a taxa');
});

console.log(fail === 0
  ? '\nOK deliveryFee-admin.guard — UI Admin reaproveita validacao/mapa, sem hardcode, sem duplicar regra'
  : `\nFALHA deliveryFee-admin.guard — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
