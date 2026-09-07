// tests/browserBackClose.golden.mjs — REF-UX-BACKBUTTON-01.
// Testa a funcao PURA decidirAcao (hooks/useBrowserBackClose.js) contra os cenarios reais relatados:
// abrir produto/carrinho e voltar deveria fechar (nunca sair do site); fechar pelo "X" nao deve
// re-fechar no proximo popstate; camadas aninhadas (2 sobrepostas) fecham uma por vez.
import { decidirAcao } from '../src/hooks/useBrowserBackClose.js';

let ok = 0;
function check(nome, cond, extra) {
  if (cond) { ok++; return; }
  console.error(`FALHOU: ${nome}`, extra ?? '');
  process.exitCode = 1;
}

// Cenario 1: nada aberto -> abre 1 camada (ex.: produto). Deve EMPURRAR 1 entrada.
check('abrir 1 camada (ex.: produto) empurra 1 entrada',
  JSON.stringify(decidirAcao(0, 1, false)) === JSON.stringify({ tipo: 'empurrar', quantidade: 1 }));

// Cenario 2: 1 camada aberta, usuario aperta VOLTAR fisico -> popstate fecha a camada (fecharTopo
// chamado pelo hook) -> profundidade cai de 1 pra 0, MAS veio do popstate (vindoDoPop=true) -> NAO
// deve tentar consumir de novo (o navegador ja consumiu sozinho ao disparar o popstate).
check('fechar via voltar fisico (popstate) nao tenta consumir de novo',
  JSON.stringify(decidirAcao(1, 0, true)) === JSON.stringify({ tipo: 'nenhuma', quantidade: 0 }));

// Cenario 3: 1 camada aberta, usuario fecha pelo "X" (nao pelo voltar) -> profundidade cai de 1 pra
// 0, NAO veio do popstate -> precisa CONSUMIR 1 entrada (equilibrar o historico).
check('fechar pelo "X" (nao pelo voltar) consome 1 entrada',
  JSON.stringify(decidirAcao(1, 0, false)) === JSON.stringify({ tipo: 'consumir', quantidade: 1 }));

// Cenario 4: 2 camadas abertas simultaneamente (ex.: carrinho + menu) -> abrir a 2a empurra mais 1
// (profundidade 1 -> 2), independente da 1a ja ter empurrado a sua.
check('abrir uma 2a camada por cima da 1a empurra mais 1',
  JSON.stringify(decidirAcao(1, 2, false)) === JSON.stringify({ tipo: 'empurrar', quantidade: 1 }));

// Cenario 5: 2 camadas abertas, voltar fecha SO' a do topo (fecharTopo fecha 1 por vez) ->
// profundidade cai de 2 pra 1, veio do popstate -> nao consome (o navegador ja consumiu).
check("voltar com 2 camadas fecha só a do topo, sem tentar consumir de novo",
  JSON.stringify(decidirAcao(2, 1, true)) === JSON.stringify({ tipo: 'nenhuma', quantidade: 0 }));

// Cenario 6: nada aberto, nada muda -> nenhuma acao (nao empurra historico a toa).
check('nada aberto -> nenhuma acao',
  JSON.stringify(decidirAcao(0, 0, false)) === JSON.stringify({ tipo: 'nenhuma', quantidade: 0 }));

// Cenario 7: fechar 2 camadas de uma vez por outro meio (ex.: sucesso do checkout fecha modal de
// endereco E troca a pagina no mesmo instante) -> consome as 2 entradas empurradas de uma vez.
check('fechar 2 camadas de uma vez (nao pelo voltar) consome as 2',
  JSON.stringify(decidirAcao(2, 0, false)) === JSON.stringify({ tipo: 'consumir', quantidade: 2 }));

console.log(ok === 7 ? '✅ browserBackClose.golden OK' : `❌ browserBackClose.golden: ${ok}/7 passaram`);
