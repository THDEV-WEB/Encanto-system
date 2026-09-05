# REF-MESA-02 — Onda 15: Impressão do QR da Mesa

**Status: CONCLUÍDA.** Fecha o gap registrado desde a Onda 4/5: `mesas.qr_token` existe e
`admin_listar_mesas` já devolvia o token desde a Onda 5 ("Admin usa pra gerar/imprimir o QR, onda
futura"), mas nenhuma tela nunca mostrava/imprimia o QR de fato.

## O que faltava e a decisão de design
O único pedaço que faltava no servidor: o Admin (bundle isolado, domínio diferente do storefront)
não tinha como saber a URL PÚBLICA da própria loja para montar o link que vai dentro do QR
(`https://<host>/?mesa_token=<uuid>`, mesmo parâmetro que `useMesaFromQuery.js` já lê desde a
Onda 5). Nenhuma RPC existente expõe `stores.slug`/`stores.dominio` a uma sessão de Admin comum
(só o Platform Console, escopo de super admin).

**`admin_obter_url_storefront()`** (nova) resolve a URL INTEIRA no servidor: usa `stores.dominio`
quando setado (é o campo que `provision_store()`/onboarding já tratam como "o domínio real desta
loja" — confirmado ao vivo para o tenant seed "encanto" → `encanto.valionsistemas.com.br`), senão
cai no padrão novo (`<slug>.lojas.valionsistemas.com.br`, o mesmo que `provision_store()` grava por
padrão desde REF-STORE-ONBOARD-01) — **nunca** o padrão legado (`<slug>.valionsistemas.com.br`,
"congelado, só Encanto usa", conforme `PlatformTenants.jsx`). Mantém toda a lógica de resolução de
domínio num único lugar (servidor) em vez de duplicar no bundle Admin.

## O que mudou
- `admin_obter_url_storefront(p_store_id)` (nova RPC, `is_admin_of` gated).
- `mesasFisicas.js::obterUrlStorefront()`.
- `AdminMesas.jsx`: botão "🔲 QR" em toda mesa (não só ocupadas — o QR serve para imprimir
  independente de estar em uso agora) abre um modal que gera o QR via `qrcode` (nova dependência —
  biblioteca padrão, ~2.8M downloads/semana, entry point browser puro, confirmado que o bundle não
  puxa as dependências Node-only do pacote — `admin.js` cresceu ~26KB gzip). O link exibido por
  extenso abaixo do QR (não só a imagem, silenciosamente) para o admin conferir visualmente antes
  de imprimir — decisão deliberada: um QR errado impresso e colado numa mesa física é um erro caro
  de reverter. Botão "Imprimir" reaproveita `printComanda()` (já existente, `comanda/
  printComanda.js` — 100% genérico, já robusto a pop-up blocker e Capacitor, usado sem nenhuma
  mudança).

## Testes
`scripts/mesa-02-onda15-impressao-qr-test.mjs` (novo, 5/5): loja com domínio personalizado usa
esse domínio; loja sem domínio usa o padrão novo por slug (nunca o legado); outsider sem
permissão; cross-tenant (admin de uma loja não vê a URL de outra onde não é admin); regressão —
`admin_listar_mesas` continua devolvendo `qr_token` (Onda 5).

Sanity check da biblioteca `qrcode` confirmado fora do teste de RPC (gera um PNG base64 válido de
verdade para um link de exemplo).

**Nota de honestidade**: como nenhuma das Ondas 8-14 (Ver conta/Trocar/Juntar/Fechar) ganhou spec
E2E Playwright dedicada — o critério usado neste REF pra UI nova do Admin de Mesas tem sido teste
de RPC (rigoroso) + lint/typecheck/build, sem clique-a-clique automatizado —, esta onda seguiu o
mesmo critério por consistência. Não houve verificação visual num navegador real; a garantia vem
de: RPC 5/5, biblioteca `qrcode` confirmada gerando PNG real, `printComanda()` já provado em
produção via `ComandaModal.jsx` (reaproveitado sem mudança), e build/lint/typecheck limpos.

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo, `build:admin` ok (bundle cresceu
~26KB gzip pela lib `qrcode`, esperado). Backend: MESA-01 (60/60) + interseção (10/10) + MESA-02
onda2-14 (155/155) + onda15 (5/5) + DELIVERY-FEE-05 (29/29) = **259/259** checks de banco +
`npm run test:domain` verde + builds limpos.

## Produção
Não tocada. Migration aplicada SOMENTE no banco E2E dedicado (`db.e2e.env`, projeto `bgzcro`).
Aditiva pura — nenhuma função existente foi alterada. `npm install qrcode` roda `npm audit`
mostrando 12 vulnerabilidades pré-existentes (5 moderadas/6 altas/1 crítica) em dependências de
DEV não relacionadas (`@capacitor/cli`/`@capacitor/assets`/`sharp`/`browserslist`/`vite`/`esbuild`)
— confirmado via `git stash` que já existiam ANTES desta instalação (CVEs recentes contra versões
já fixadas no lockfile, nada que este REF introduziu); fora de escopo desta REF, registrado só
como observação.
