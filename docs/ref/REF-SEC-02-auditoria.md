# REF-SEC-02 — Rate limiting / CSP / npm audit

**Status: FECHADA — npm audit + CSP + rate limiting, todos ao vivo em produção (2026-08-21).**

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

### Validação em produção

Deploy confirmado — headers reais conferidos ao vivo (com cache-buster, driblando um `X-Vercel-Cache:
HIT` inicial que ainda servia a resposta pré-deploy) em `encanto.valionsistemas.com.br` E
`admin.encanto.valionsistemas.com.br`, byte a byte iguais à política testada localmente. Smoke real
via Playwright contra o site AO VIVO (não build local): página carrega, mapa (Leaflet, `unpkg.com` +
tiles OSM) abre e funciona, **0 violações de CSP no console real do navegador**.

### Commits

`0ca3322` (`vercel.json`) + `ebc6fcd` (doc) — **pushed e deployados, confirmados ao vivo**.

## 3. Rate limiting nas RPCs próprias

### Achado

Supabase não expõe rate limiting genérico de RPC via dashboard (só tem para endpoints de Auth —
login/OTP, `signInWithOtp`/`verifyOtp`, já protegidos nativamente). `create_order` e
`save_structured_address` — ambas `SECURITY DEFINER`, anon-callable, sem sessão nenhuma exigida —
não tinham nenhum throttle. Um script poderia martelar essas RPCs sem fricção nenhuma: além de poluir
dados, o pipeline de notificação WhatsApp (`pg_cron`, ver `REF-ORDER-01`) dispararia para CADA pedido
forjado — spam real no WhatsApp do dono da loja, não só um problema de dado sujo.

### Chave de identidade — descoberta real, testada empiricamente

Testado em E2E (gatilho temporário e gated em `resolve_store_from_origin()`, revertido logo depois,
zero traço): enviei `X-Forwarded-For`/`X-Real-IP` forjados via `curl` contra a RPC real. O header
`cf-connecting-ip` — que o próprio Cloudflare da borda do Supabase sempre popula com o IP real da
conexão TCP, nunca confiando no que o client manda — **continuou correto**, mesmo com os outros
headers forjados. Mais forte que `Origin` (que só é protegido pelo navegador; ferramentas como
`curl`/scripts ainda conseguem forjar `Origin`, mas não `cf-connecting-ip`).

### Desenho

Nova tabela `rate_limit_hits` (bucket, ip_key, created_at) com RLS habilitada e **zero policy**
(default-deny — mesmo padrão de `application_logs`: grants automáticos do Supabase pra
anon/authenticated existem, mas RLS sem policy bloqueia tudo mesmo assim). Helper
`_rate_limit_hit(bucket, max, window)`: insere 1 hit, conta hits recentes daquele IP naquele bucket,
compara com o limite — **fail-open** (qualquer erro interno libera a chamada; um bug no limiter nunca
pode bloquear um pedido real). Hookado em 2 pontos: `create_order` (retorna
`{ok:false, error:'muitas tentativas...'}`, mesmo contrato dos outros DENY) e
`save_structured_address` (`RAISE EXCEPTION`, mesmo contrato de `'loja nao identificada'`).

**Achado de segurança na própria implementação**: `_rate_limit_hit`/`rate_limit_purge` vieram com
EXECUTE concedido a `anon`/`authenticated` **automaticamente** (privilégio padrão do Supabase pra
função nova no schema `public` — confirmado por introspecção logo após a 1ª aplicação). Corrigido com
`REVOKE` explícito, mesmo padrão já usado por `loyalty_grant`/`enc_dispatch_notifications`/
`purge_old_logs` (só `postgres`/`service_role`). Confirmado via HTTP real: chamar
`/rest/v1/rpc/_rate_limit_hit` direto agora dá `401 permission denied`.

### Calibração do limiar — recalibrado com evidência real

Primeira tentativa: 20 chamadas/IP a cada 10 min (baseado no volume real da loja, 1-3 pedidos/hora).
Ao rodar a suíte E2E completa (que semeia pedidos de fixture em ~15-20 specs, todos da MESMA
máquina/IP), a própria suíte gerou **33 chamadas reais de `create_order` em ~9 minutos** — estourou o
limiar de 20, causando uma cascata de 20 falhas em specs completamente não relacionados (Admin,
Fidelidade, Relatórios) sem nenhum bug real por trás. Recalibrado para **60 chamadas/IP a cada 10
minutos** — folga confortável sobre esse pico real observado (rodando de novo: 36 chamadas reais,
zero denial), continua muitíssimo abaixo de qualquer flood de verdade (script malicioso tentaria
centenas/milhares por minuto) e nunca afetaria clientes reais mesmo atrás de CGNAT compartilhado
(comum em operadora móvel no Brasil), dado o volume real de 1-3 pedidos/**hora** no total da loja.

### Testes

**SQL simulado** (E2E e produção, `BEGIN...ROLLBACK`): 60 chamadas do mesmo IP → todas `ok:true`; a
61ª → negada (`'muitas tentativas, aguarde um momento'`); IP diferente → não afetado; sem
`cf-connecting-ip` → fail-open, permite mesmo com o IP anterior estourado; chamada direta a
`_rate_limit_hit` como `anon` → negada por privilégio (`insufficient_privilege`). Mesma matriz pra
`save_structured_address` em E2E.

**Regressão E2E** — achado real durante a própria validação (ver Calibração acima), resolvido com o
limiar de 60. Suíte completa depois da correção: 116 passaram; os 7-8 restantes confirmados
pré-existentes/ambientais via A/B (migration revertida temporariamente em E2E, specs rodados de novo,
falharam de forma IDÊNTICA sem nenhuma mudança desta REF) — zero regressão nova atribuível ao rate
limiting.

**HTTP real** contra produção: `_rate_limit_hit` direto → `401 permission denied` (confirma o
REVOKE); `create_order` normal → `ok:true`, pedido real criado e removido logo em seguida (prova que
a funcionalidade comum não foi afetada). Integridade final idêntica ao baseline (18 customers/102
orders/22 addresses).

### Produção

Pré-check (hash antes, contagem) → migration aplicada (tabela+funções+2 RPCs atualizadas+job
`pg_cron` `encanto-rate-limit-purge`, hora em hora) → achado do EXECUTE público corrigido com REVOKE
→ matriz SQL simulada → smoke HTTP real → limpeza imediata → integridade confirmada.

### Commits

`REF-SEC-02-onda1-rate-limit.sql` + rollback.
