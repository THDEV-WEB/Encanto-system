# REF-BRAND-02 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

**Contexto:** evolução da identidade institucional — troca do texto "Plataforma desenvolvida por TH
System" no rodapé do Encanto por uma assinatura da Valion Sistemas, com o símbolo oficial da marca
(arquivo enviado pelo dono) substituindo o "V" de VALION. Detalhe completo (decisões, medições de
contraste, técnica de recorte) em `docs/adr/REF-BRAND-02-assinatura-institucional.md`.

## Estado atual

✅ CONCLUÍDA. Implementado, validado (gates + visual real), documentado. Aguardando aprovação final
do dono para commit/push/deploy.

## Linha do tempo do design (protótipos via Artifact, antes de tocar o código real)

1. Análise crítica (UX/branding/acessibilidade) + protótipo v1: selo separado, cores inventadas
   (roxo/cinza do Encanto) — aprovado o *conceito*.
2. Dono enviou o logo oficial da Valion (arquivo raster, sem vetor). Extraídas cores reais via
   PowerShell/`System.Drawing` (amostragem de pixel): navy `#070E20`, azul `#0E68F7`, tagline
   `#494D56`.
3. v2: logo completo num cartão branco (limitação técnica: fita prateada da marca se dissolve até
   branco puro, impossível remover por brilho sem cortar a arte).
4. Dono pediu OUTRA composição (ícone no lugar do "V", tagline nova "Soluções digitais que
   impulsionam negócios."): v3.
5. **Correção crítica do dono:** proibido qualquer fundo/card/borda/divisor novo no rodapé — regra
   absoluta, documentada literalmente na ADR. v4 remove o `border-top` que eu tinha adicionado sem
   pedido.
6. Dono apontou que a fita prateada estava "lavando" contra o creme na v4 (a extração de alfa por
   brilho também afetava os tons claros DA PRÓPRIA arte, não só o fundo). Corrigido com *flood fill*
   a partir da borda da imagem (só remove o que está CONECTADO ao canto branco) — fita 100% opaca
   nas duas cores, sem se perder em fundo nenhum. v4b aprovada ("prossiga").

## Implementação real

Status: ✅ CONCLUÍDA.
- `public/valion-mark.png` — símbolo final (flood-fill, 300×254, ~38KB).
- `src/components/ValionCredit.jsx` — componente puro (entra no `render.smoke`).
- `src/index.css` — bloco `VALION CREDIT` (zero `background`/`border` em qualquer regra/estado).
- `src/pages/StoreApp.jsx` — `<ValionCredit />` no lugar do texto antigo, padding externo idêntico
  (`32px 16px`).
- `tests/render.smoke.mjs` — folha `ValionCredit` nova, markup congelado.

## VALIDAÇÃO

- ✅ `npm run build`: limpo.
- ✅ `node tests/render.smoke.mjs`: 15/15 folhas.
- ✅ `npm run test:domain`: verde.
- ✅ `npm run test:e2e` (Chromium, completa): **113 passed**.
- ✅ Visual real (Playwright ad-hoc contra `npm run dev`, script temporário fora do repo):
  desktop 1280px + mobile 375px + `prefers-reduced-motion`, screenshots do componente real em
  estado normal/hover/foco, zero erro de console em qualquer viewport.
- ✅ `git status --short`: diff restrito exatamente aos arquivos esperados.

## Pendente

Aprovação final do dono → commit → push → deploy (Vercel auto-deploy via GitHub, mesmo pipeline da
REF-BRAND-01) → validação em produção (`https://valionsistemas.com.br/encanto`).
