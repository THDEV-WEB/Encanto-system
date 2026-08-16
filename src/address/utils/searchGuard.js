/* address/utils/searchGuard.js — REF-ADDRESS-AUTOCOMPLETE-01 (auditoria 2026-08-17, gap "race
   condition real, não coberta por teste": useAddressSearch.js debounça com setTimeout, mas duas buscas
   podem ficar em voo ao mesmo tempo (rede lenta) e a rede pode entregar a resposta da mais ANTIGA
   depois da mais NOVA — sobrescrevendo sugestões atuais com um resultado obsoleto.

   criarGuardiaoSequencia() garante que só a ÚLTIMA busca iniciada pode aplicar seu resultado; qualquer
   resposta de uma chamada anterior é ignorada. Pura (sem React/IO), testável sem precisar de um
   test-renderer de hooks, que o projeto ainda não tem — a alternativa (AbortController plumbado por
   nominatimService/photonProvider/mapboxProvider/waterfallGeocoder/geocodingService) cancelaria a
   requisição de verdade, mas exigiria mudar a assinatura de 5 arquivos de I/O só para um ganho marginal
   (a requisição cancelada ainda seria rápida e barata); esta guarda resolve a causa raiz (estado
   sobrescrito por resposta obsoleta) com uma mudança só no hook. */
export function criarGuardiaoSequencia() {
  let atual = 0;
  return {
    /* Marca o início de uma nova busca — invalida qualquer chamada anterior ainda em voo. */
    iniciar() { return ++atual; },
    /* A busca identificada por `seq` ainda é a mais recente? */
    aindaValido(seq) { return seq === atual; },
  };
}
