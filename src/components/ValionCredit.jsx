/* components/ValionCredit.jsx — REF-BRAND-02.
   Assinatura institucional da Valion Sistemas no rodapé da loja, no lugar do antigo texto
   "Plataforma desenvolvida por TH System". Regra do dono: ZERO fundo/card/borda/divisor novo —
   herda o que já está atrás (mesmo padding do bloco antigo, ver StoreApp.jsx). Ícone (public/
   valion-mark.png) substitui o "V" de VALION, recortado com fundo transparente real (preenchimento
   a partir das bordas — preserva a fita prateada 100% opaca, sem lavar contra o creme). Cores/
   tagline extraídas do arquivo de marca oficial fornecido pelo dono. Apresentacional puro (sem
   hooks/DS/browser) -> entra no render.smoke. */
export function ValionCredit() {
  return (
    <a
      className="valion-credit-link"
      href="https://valionsistemas.com.br"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Valion Sistemas — visitar site institucional (abre em nova guia)"
    >
      <span className="valion-eyebrow">Plataforma desenvolvida por</span>
      <span className="valion-word">
        <img
          className="valion-v-icon"
          src={`${import.meta.env.BASE_URL}valion-mark.png`}
          alt=""
          loading="lazy"
        />
        <b>ALION</b>
        <i>SISTEMAS</i>
      </span>
      <span className="valion-underline" aria-hidden="true" />
      <span className="valion-tagline">Soluções digitais que impulsionam negócios.</span>
    </a>
  );
}
