# REF-SEC-02 — Rate limiting / CSP / npm audit

**Status: EM ANDAMENTO — npm audit + CSP prontos (local), aguardando autorização de deploy. Rate
limiting ainda não iniciado.**

## 1. `npm audit`

14 vulnerabilidades encontradas, **todas** rastreadas até `devDependencies` (`@capacitor/cli`,
`@capacitor/assets`, `vite`, `vite-plugin-pwa`) — as 8 dependências reais de runtime (`react`,
`react-dom`, `@supabase/supabase-js`, `@sentry/react`, `@capacitor/core|android|app|browser`)
confirmadas limpas via `npm ls`. Ou seja: risco real é sobre a máquina de build/dev, nunca sobre o
app publicado.

`npm audit fix` (não-destrutivo) resolveu 5/14 (`brace-expansion`, `fast-uri`, `nanoid`,
`minimatch`) — só `package-lock.json` mudou, `package.json` intacto. Validado: `test:domain` verde,
`build`+`build:admin` verdes, E2E de checkout limpo.

**Restam 9** (4 pacotes distintos), todas em devDependencies:
- `esbuild`/`vite` (moderado) — fix exige `vite@8` (breaking change; `vite.config.js` tem
  customização significativa: dual-build Capacitor/Admin/convite, plugin do Sentry, PWA). Não
  aplicado — decisão separada, fora do escopo desta rodada.
- `sharp`/`uuid`/`tar` (alto/crítico) — presos dentro de `@capacitor/assets` (ferramenta de gerar
  ícone/splash, uso manual/esporádico) via `@trapezedev/project`/`xcode` — **sem fix automático
  disponível**, nem com `--force`.

Commit local `9be94ad`.

## 2. Content-Security-Policy + headers de segurança

### Achado (antes de qualquer mudança)

Confirmado: **zero** header de segurança em produção hoje (`vercel.json` não define nenhum,
nenhum HTML tem meta CSP).

### Levantamento de recursos externos legítimos (base da allowlist)

Auditoria completa de todo `fetch`/`<script>`/`<link>`/`<img>` externo no código-fonte:

- **Supabase** (REST/RPC/Storage) — `hvbcdxsagkjtfjwvnslo.supabase.co`.
- **Sentry** (ingest) — `o4511791896002560.ingest.de.sentry.io` (mesmo DSN já documentado em
  `REF-OBS-02`).
- **Leaflet** (CDN, sob demanda) — CSS/JS **e ícones do marcador** de `unpkg.com` (achado real, ver
  seção Testes).
- **Tiles do mapa** — `{a,b,c}.tile.openstreetmap.org`.
- **Geocoding** — `api.mapbox.com` (opcional, só com `VITE_MAPBOX_TOKEN`), `nominatim.openstreetmap.org`,
  `photon.komoot.io`, `viacep.com.br`.
- **Google Fonts** — `fonts.googleapis.com` (stylesheet) + `fonts.gstatic.com` (arquivos de fonte).
- **Avatar do Google** (login OAuth) — `*.googleusercontent.com` (`img-src`; o OAuth em si é um
  redirect de página inteira, não passa por `connect-src`/`script-src`).
- **Unsplash** — `images.unsplash.com` (só no fallback MOCK offline).
- Inline: `<style>@keyframes...</style>` presente nos 3 HTMLs (index/admin/convite) + `style` inline
  do React em toda a UI — exige `'unsafe-inline'` em `style-src` (sem isso, praticamente toda a UI
  quebraria visualmente).
- Confirmado **zero** `<form>` no código (app 100% JS-driven) — `form-action 'self'` seguro.
- Confirmado **zero** uso de Realtime/WebSocket do Supabase — sem necessidade de `wss:` em
  `connect-src`.

### Política aplicada (`vercel.json`, todas as rotas — loja e admin compartilham o mesmo arquivo)

```
default-src 'self';
script-src 'self' https://unpkg.com;
style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com;
img-src 'self' data: blob: https://hvbcdxsagkjtfjwvnslo.supabase.co https://images.unsplash.com
  https://*.tile.openstreetmap.org https://*.googleusercontent.com https://unpkg.com;
font-src 'self' https://fonts.gstatic.com data:;
connect-src 'self' https://hvbcdxsagkjtfjwvnslo.supabase.co https://o4511791896002560.ingest.de.sentry.io
  https://api.mapbox.com https://nominatim.openstreetmap.org https://photon.komoot.io https://viacep.com.br;
frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none';
```

Mais `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` (compat com navegadores
antigos, redundante com `frame-ancestors`), `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: geolocation=(self), camera=(), microphone=()` (geolocalização usada pela busca
de endereço via GPS; câmera/microfone nunca usados, bloqueados).

### Testes — evidência real, não suposição

Build de produção real (`npm run build --mode e2e` para o lado loja, credenciais do projeto E2E —
seguro para specs `@writes`; `npm run build:admin` para o admin) servido por um servidor HTTP local
dedicado que injeta EXATAMENTE os headers acima, byte a byte iguais aos do `vercel.json` final.

- **Suíte Playwright completa** contra o build da loja com CSP real: 60 passaram; as falhas restantes
  foram todas de specs de `admin/*` (o servidor de teste da loja não hospeda `admin.html` — limitação
  do arpetato de teste, não da CSP) mais as 2 já documentadas como pré-existentes/flaky
  (`checkout-logado`, `minha-conta`). **Zero falha nova atribuível à CSP.**
- **Tela de login do Admin** (build real, sem autenticar): 0 violações de console — confirma Sentry,
  Fonts, inline style, bundle próprio.
- **Interação real com o mapa** (Leaflet, fluxo de endereço da loja): **achado real** — os ícones do
  marcador (`marker-icon.png`/`marker-shadow.png`) também vêm de `unpkg.com`, não só CSS/JS;
  `img-src` inicial não incluía isso, o mapa carregaria sem o pino visível. Corrigido antes do
  commit; reconfirmado depois: `window.L` carregado, 10 requisições unpkg/tile bem-sucedidas, **0
  violações de CSP**.
- Todas as violações reais capturadas via listener de `console` do Playwright (mensagem literal do
  Chromium: "Refused to ... because it violates the following Content Security Policy directive"),
  nunca inferidas.

### Commit

`0ca3322` (só `vercel.json`) — **local, push/deploy ainda não solicitado** (diferente da
REF-OBS-02, que teve deploy explicitamente autorizado; aqui a autorização recebida cobriu
auditoria+implementação+teste local, não deploy).

## 3. Rate limiting nas RPCs próprias

**Não iniciado.** Achado da auditoria: Supabase não expõe rate limiting genérico de RPC via
dashboard (só tem para endpoints de Auth); as RPCs públicas mais sensíveis (`create_order`,
`save_structured_address`, RPCs de login/OTP) não têm nenhum throttle hoje. Uma solução real exigiria
uma migration nova (contador por telefone/IP dentro do próprio Postgres) — escopo mais parecido com
as REFs de tenant desta sessão do que com um ajuste de configuração, então fica registrado aqui como
próximo passo, não implementado nesta rodada sem autorização explícita adicional.
