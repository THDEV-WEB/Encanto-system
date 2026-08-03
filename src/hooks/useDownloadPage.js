/* hooks/useDownloadPage.js — REF-CAP-01 · Onda 7 (Distribuição).
   Pseudo-rota por PATH real (nao hash) — o pedido explicito era uma URL de verdade, compartilhavel/
   visitavel direto: https://valionsistemas.com.br/encanto/download. Checado 1x no mount (useState com
   funcao inicializadora) — nao reage a navegacao subsequente porque esta SPA nao tem router nenhum, so
   essa unica entrada. Precisa do rewrite em vercel.json (sem ele, o path nao existe fisicamente no
   deploy estatico e o Vercel devolveria 404 antes do bundle JS sequer carregar). */
import { useState } from 'react';

export function useDownloadPage() {
  const [isDownloadPage] = useState(() => {
    if (typeof window === 'undefined') return false;
    const base = import.meta.env.BASE_URL || '/';
    return window.location.pathname === `${base}download`;
  });
  return isDownloadPage;
}
