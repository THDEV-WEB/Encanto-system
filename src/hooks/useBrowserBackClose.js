/* hooks/useBrowserBackClose.js — REF-UX-BACKBUTTON-01.
   Faz o botao/gesto "voltar" do NAVEGADOR (Android Chrome, WhatsApp in-app browser, PWA instalada —
   tudo que NAO e' o app nativo Capacitor, ver hooks/useCapacitorBackButton.js pra esse) fechar a
   camada de UI aberta (produto, carrinho, endereco, checkout, fidelidade, menu) em vez de sair do
   site inteiro.

   CAUSA RAIZ (relatada pelo dono, 2026-09-07): o app e' 100% SPA state-driven, sem router, sem NUNCA
   empurrar entrada nenhuma no historico do navegador ao abrir um modal/carrinho/tela. O botao fisico
   "voltar" do Android e' um evento de NAVEGACAO DO PROPRIO NAVEGADOR (history.back()), nao um evento
   Capacitor -- sem nenhuma entrada no historico pra "desfazer", ele sai direto do site. Isso e'
   ORTOGONAL ao useCapacitorBackButton (que intercepta o evento NATIVO do Android diretamente, nunca
   passa pelo historico do navegador) -- os dois convivem sem conflito, cada um tratando sua propria
   plataforma.

   MECANISMO: cada camada aberta (na ordem de prioridade de fechamento, mais recente/por cima
   primeiro -- mesma ordem ja usada por fecharTopo) empurra 1 entrada de historico. "Voltar"
   fisico/gesto consome 1 entrada (popstate) -> fecha SO' a camada do topo. Fechar uma camada por
   OUTRO meio (botao "X", onBack etc., nao pelo popstate) consome/equilibra a entrada empurrada via
   history.go() -- o historico nunca fica com entrada sobrando nem faltando. Com NADA aberto, voltar
   funciona exatamente como antes (sai do site) -- nao criamos historico nenhum sem necessidade. */
import { useEffect, useRef } from 'react';

/* PURA, sem DOM/React — testada isoladamente em tests/browserBackClose.golden.mjs, mesma disciplina
   de deliveryFeeRules.js: dado profundidade anterior/atual e se a mudanca veio de um popstate que ja
   tratamos, decide quantas entradas empurrar (positivo) ou consumir (negativo). */
export function decidirAcao(profundidadeAnterior, profundidadeAtual, vindoDoPop) {
  const delta = profundidadeAtual - profundidadeAnterior;
  if (delta > 0) return { tipo: 'empurrar', quantidade: delta };
  if (delta < 0 && !vindoDoPop) return { tipo: 'consumir', quantidade: -delta };
  return { tipo: 'nenhuma', quantidade: 0 };
}

/* camadasAbertas: array de booleans, JA na ordem de prioridade (topo primeiro) -- normalmente o
   mesmo array que alimenta fecharTopo. fecharTopo: fecha exatamente 1 camada (a de maior
   prioridade que estiver aberta), mesma funcao usada pelo Capacitor. */
export function useBrowserBackClose(camadasAbertas, fecharTopo) {
  const profundidadeRef = useRef(0);
  const suprimirPopsRef = useRef(0);
  const vindoDoPopRef = useRef(false);
  const fecharTopoRef = useRef(fecharTopo);
  fecharTopoRef.current = fecharTopo;

  const profundidadeAtual = camadasAbertas.filter(Boolean).length;

  useEffect(() => {
    const acao = decidirAcao(profundidadeRef.current, profundidadeAtual, vindoDoPopRef.current);
    if (acao.tipo === 'empurrar') {
      for (let i = 0; i < acao.quantidade; i++) window.history.pushState({ encantoOverlay: true }, '', window.location.href);
    } else if (acao.tipo === 'consumir') {
      // Fechado por outro meio (botao "X", onBack, etc.) -- consome as entradas empurradas sem
      // reagir ao(s) popstate(s) resultante(s) (senao fecharia uma camada que ja fechamos por conta propria).
      suprimirPopsRef.current += acao.quantidade;
      window.history.go(-acao.quantidade);
    }
    vindoDoPopRef.current = false;
    profundidadeRef.current = profundidadeAtual;
  }, [profundidadeAtual]);

  useEffect(() => {
    function onPopState() {
      if (suprimirPopsRef.current > 0) { suprimirPopsRef.current -= 1; return; }
      if (profundidadeRef.current > 0) {
        vindoDoPopRef.current = true;   // avisa o efeito acima: este fechamento ja' veio do popstate
        fecharTopoRef.current?.();
      }
      // profundidadeRef.current === 0 (nada nosso aberto): deixa o navegador seguir seu proprio
      // historico normalmente -- exatamente o comportamento de sempre.
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
