# REF-MOBILE-01 — Fundação Mobile (PWA Ready + Capacitor Ready)

**Status:** 🚧 Em execução — Ondas 1–4 (Manifest, Ícones, Head mobile/SEO, este ADR) concluídas e
commitadas; Ondas 5–7 (Validação, Service Worker, Testes finais) em andamento na mesma sessão.
**Depende de:** [REF-BRAND-01](REF-BRAND-01-dominio-institucional.md) (o app vive sob o sub-path
`/encanto/`, via rewrite/proxy do domínio institucional — todo `start_url`/`scope`/path de ícone desta
REF herda essa decisão). Precedente de [REF-COMPANY-02](REF-COMPANY-02-nome-em-toda-parte.md): nome
institucional hardcoded em `index.html`/`main.jsx` já foi aceito ali como **limitação arquitetural, não
pendência** (manifest estático não lê `company_info` do banco — mesma natureza).
**Relacionado:** primeira REF deste projeto a tornar o app **instalável** (PWA). Prepara terreno para
uma REF futura de adoção do **Capacitor** (Android/iOS nativos) — Capacitor **não é instalado nesta
REF**, só as decisões que evitam retrabalho quando isso acontecer.

## Objetivo

Transformar o Encanto num PWA instalável de nível profissional (manifest, ícones, meta tags mobile,
Service Worker seguro), preservando 100% da arquitetura/regras de negócio/fluxos de autenticação/
checkout/catálogo/admin existentes, e deixando documentadas as decisões que tornam uma futura adoção do
Capacitor (Android/iOS) o mais parecida possível com "plug-and-play".

## Auditoria (estado inicial)

Levantamento completo (sem nenhuma mudança de código) apresentado e aprovado antes desta execução.
Achados principais:

- **Zero infraestrutura de PWA existia:** nenhum `manifest`, nenhum Service Worker, nenhum ícone
  dedicado (só `logo.jpg` — um lockup completo com texto, `header-bg.jpg` e `valion-mark.png`, nenhum
  deles utilizável como ícone de app em tamanho pequeno).
- `index.html` sem `<link rel="icon">`, sem `apple-touch-icon`, sem `theme-color`, sem
  `apple-mobile-web-app-*`, sem `meta description`, sem Open Graph/Twitter Card.
- `viewport` com `maximum-scale=1.0` (trava pinch-zoom — falha de acessibilidade WCAG 1.4.4) e sem
  `viewport-fit=cover` — os 3 usos existentes de `env(safe-area-inset-bottom)` (`ScreenModal.jsx`,
  `SideDrawer.jsx`, `Toast.jsx`) sempre resolviam para `0` por falta desse último.
- OAuth Google (`AuthService.signInWithGoogle`) usa `redirectTo: window.location.origin + BASE_URL`
  (redirect de browser padrão) — funciona perfeitamente em PWA/browser, mas **não sobrevive a um WebView
  nativo do Capacitor sem troca de transporte** (precisa de `@capacitor/browser` + deep link).
  `flowType: 'pkce'` (já usado em `dbCliente.js`) é exatamente o que esse padrão nativo exige — a base
  já está correta, só falta o transporte quando o Capacitor existir.
- `vite.config.js` fixa `base: '/encanto/'` + `outDir: 'dist/encanto'` — necessário para o proxy
  institucional (REF-BRAND-01). Um build nativo Capacitor precisaria servir da raiz.
- `window.print()` (comanda térmica do Admin, `printComanda.js`, via iframe oculto) não tem diálogo de
  impressão nativo em WebView Android/iOS sem plugin dedicado — baixo risco agora (Admin não é o alvo do
  app nativo inicial).
- Fontes (Poppins) carregadas de `fonts.googleapis.com` — dependência de rede externa, incompatível com
  offline 100% completo.
- Bundle único sem code-splitting (~168 KB gzip JS) — aceitável, não bloqueador.

Prontidão medida por checklist ponderado: **PWA ≈ 25%**, **Android/Capacitor ≈ 40%**, **iOS/Capacitor ≈
30%** — a base responsiva/arquitetural já era sólida (HTTPS, sem SSR, sessão via `localStorage` em vez
de cookie, sem API exclusiva de browser incompatível com WebView além do `window.print()` do Admin);
faltava inteiramente a camada de instalabilidade.

## Decisões

### D1 — Manifest: `id`/`start_url`/`scope` = `"/encanto/"`

O app não usa `react-router` (SPA de rota única, decisão pré-existente documentada em REF-BRAND-01) e
vive inteiro sob `/encanto/` via proxy do domínio institucional. `start_url` e `scope` do manifest
precisam bater exatamente com isso — um valor errado (ex.: `"/"`) quebraria a instalação, já que a raiz
do domínio pertence a outro projeto (a landing institucional). `id` fixo evita que o navegador trate
instalações antigas/novas como apps diferentes se `start_url` ganhar uma query string no futuro.

### D2 — Ícone: símbolo isolado fornecido pelo dono, um único arquivo por tamanho (`purpose: "any maskable"`)

O dono forneceu `public/icon-encanto.png` (1080×1080, panela + açaí, **sem texto**, fundo magenta sólido
full-bleed) — exatamente o tipo de ativo que faltava (o `logo.jpg` existente é um lockup com texto,
ilegível em ícone pequeno). Como o fundo já é full-bleed e o símbolo central já respeita a "safe zone"
usada por máscaras adaptáveis (círculo/squircle do Android), **não foi necessário gerar uma variante
"maskable" com padding extra** — os mesmos `icon-192.png`/`icon-512.png` são declarados no manifest com
`"purpose": "any maskable"`, evitando arquivos duplicados sem ganho real.

### D3 — `favicon.ico` multi-resolução escrito à mão (sem ferramenta externa)

Não há ImageMagick nem `sharp` disponíveis neste ambiente. Em vez de adicionar uma dependência nova só
para empacotar um `.ico`, o container foi montado manualmente (script Node descartável, fora do repo):
formato ICO padrão com 3 imagens PNG embutidas (16/32/48px, suportado nativamente desde o Windows Vista
e por todos os browsers relevantes). Validado carregando o arquivo de volta via `System.Drawing.Icon`.

### D4 — `viewport`: remoção de `maximum-scale=1.0`, adição de `viewport-fit=cover`

Única mudança desta REF com efeito visual perceptível (o usuário passa a poder dar pinch-zoom, antes
travado). Já prevista e sinalizada na auditoria antes da aprovação. `viewport-fit=cover` é pré-requisito
técnico para os `env(safe-area-inset-*)` já escritos no CSS (não são código novo desta REF) passarem a
ter efeito de verdade em iPhones com notch/Dynamic Island — sem essa mudança, aquele CSS sempre foi
inerte.

### D5 — `apple-mobile-web-app-status-bar-style` = `"default"` (não `"black-translucent"`)

`black-translucent` faria o conteúdo passar por baixo da status bar do iOS, exigindo que **toda tela**
trate `safe-area-inset-top` — hoje só `safe-area-inset-bottom` é tratado, em 3 componentes. Ir para
`black-translucent` exigiria auditar/ajustar telas adicionais, o que extrapolaria o escopo aprovado
("preservar integralmente a arquitetura atual", sem alterações fora do head). `"default"` entrega app
instalável em standalone no iOS sem esse risco.

### D6 — `robots.txt` **não** criado neste repositório

Um `robots.txt` só é respeitado por crawlers na **raiz do domínio** (`https://dominio/robots.txt`) —
nunca num sub-path. Este repositório serve exclusivamente `/encanto/*` (proxy Vercel, REF-BRAND-01); um
`robots.txt` colocado em `public/` aqui seria publicado em `/encanto/robots.txt`, que nenhum crawler
consulta. A raiz real do domínio (`valionsistemas.com.br/robots.txt`) pertence ao repositório da landing
institucional (`valion-sistemas-site`), fora do alcance desta REF. Registrado aqui para não ser
reintroduzido por engano numa REF futura sem o mesmo contexto.

### D7 — Open Graph / Twitter Card usam `logo.jpg` (lockup completo), não `icon-encanto.png`

Para preview de link compartilhado (WhatsApp/Instagram), a marca por extenso (com o nome escrito) é mais
reconhecível que o símbolo isolado — o inverso do critério usado para o ícone de app (D2), onde o texto
atrapalha em tamanho pequeno. `logo.jpg` já existia, nenhum ativo novo foi necessário.

### D8 — Service Worker: escopo restrito, `network-only` para Supabase/OAuth *(Onda 6)*

*(preenchido ao final da Onda 6 — ver seção própria abaixo)*

### D9 — Capacitor-Ready: decisões registradas, nada implementado agora

Sem adicionar `@capacitor/core` nem qualquer dependência nova, ficam registradas as decisões que
evitariam retrabalho quando o Capacitor for de fato adotado:

1. **OAuth Google em WebView nativo:** o transporte atual (`window.location.origin + BASE_URL`,
   redirect de browser) é correto para PWA/browser e **deve continuar assim** enquanto não existir app
   nativo. Quando o Capacitor for adotado, `AuthService.signInWithGoogle()` (único ponto de chamada,
   `src/services/AuthService.js`) precisará trocar `redirectTo` por um custom URL scheme (ex.:
   `com.valion.encanto://auth-callback`) e o fluxo passa a usar `@capacitor/browser`
   (`Browser.open({ url })` em vez do redirect direto) + um listener `App.addListener('appUrlOpen', ...)`
   que captura o retorno e conclui a sessão via `dbCliente.auth.exchangeCodeForSession(url)`. O
   `flowType: 'pkce'` já configurado em `lib/dbCliente.js` é exatamente o exigido por esse padrão — zero
   mudança necessária ali. Ponto de atenção extra para iOS: a App Store (guideline 4.8) exige
   `ASWebAuthenticationSession` para login social em apps nativos — o plugin `@capacitor/browser` já
   usa esse mecanismo por baixo dos panos no iOS.
2. **`base` de build dual:** o build web de produção continua `base: '/encanto/'` /
   `outDir: 'dist/encanto'` (não muda, é o que o rewrite institucional espera). Um build nativo
   Capacitor precisaria de `base: '/'` (o WebView do Capacitor serve o `webDir` a partir da própria
   raiz, `capacitor://localhost/` ou `https://localhost/`, dependendo da plataforma) — isso seria um
   **modo de build adicional** (`vite build --mode capacitor` com um `vite.config.js` condicional no
   `base`/`outDir` conforme `mode`), não uma mudança no build web existente.
3. **`window.print()` do Admin (comanda térmica):** funciona hoje via iframe oculto (browser/PWA). Sem
   suporte nativo a diálogo de impressão em WebView Android/iOS. Não é um bloqueador — o Admin não é o
   alvo do app nativo inicial (o público é o cliente da loja). Se um dia o Admin também rodar dentro de
   Capacitor, a solução seria um plugin de impressão dedicado (ex. impressora térmica Bluetooth via
   plugin nativo) — fora de escopo até essa decisão de produto existir.
4. **Sentry nativo:** `@sentry/react` (já em uso) continua cobrindo 100% dos erros JavaScript dentro de
   um WebView Capacitor, sem mudança nenhuma. `@sentry/capacitor` (crash nativo de nível iOS/Android)
   só faria sentido avaliar quando o app nativo existir de fato — não antes.
5. **Geolocalização (`navigator.geolocation`, usada em `src/address/hooks/useAddressSearch.js`):** a
   API padrão do browser funciona normalmente dentro do WebView do Capacitor sem mudança nenhuma; trocar
   pelo plugin `@capacitor/geolocation` seria só uma melhoria opcional de UX de permissão nativa, nunca
   uma exigência.

## Onda 1 — Web App Manifest

`public/manifest.json` (`id`/`start_url`/`scope` = `/encanto/`, `display: standalone`,
`background_color: #ffffff` — mesma cor do `.bg-layer`/corpo atual do app, evita flash de cor no splash
gerado pelo Android —, `theme_color: #6B1F5D`/`--roxo`, `categories: ["food","shopping"]`) +
`<link rel="manifest">` em `index.html`. Commit `8c8a7ce`.

## Onda 2 — Conjunto de ícones

A partir de `public/icon-encanto.png` (fornecido pelo dono): `icon-192.png`, `icon-512.png` (manifest,
D2), `apple-touch-icon.png` (180×180, opaco), `favicon.ico` (D3) + `favicon-32.png`/`favicon-16.png`
(fallback `<link>` explícito). Redimensionamento em alta qualidade (`HighQualityBicubic`), sem reencode
com perda adicional. `<link rel="icon"/apple-touch-icon">` em `index.html`. Commit `7e1e6fd`.

## Onda 3 — Head mobile/SEO

`viewport-fit=cover` + remoção de `maximum-scale` (D4); `theme-color`; `mobile-web-app-capable` +
`apple-mobile-web-app-*` (D5); `meta description`; Open Graph + Twitter Card (D7); `robots.txt`
deliberadamente **não** criado (D6). Commit `d1fb48b`.

## Onda 4 — Este ADR

Documentação das decisões acima + estratégia "PWA Ready + Capacitor Ready" (D9). Sem mudança de código.

## Onda 5 — Validação mobile

Sem hardware Android/iOS físico neste ambiente (máquina Windows, sessão de agente) — validação dividida
em duas camadas, deliberadamente:

**Camada automatizada (executada nesta Onda, script ad-hoc via Playwright/Chromium, não commitado —
ferramenta de verificação pontual, não infraestrutura de teste permanente):**
- `manifest.json` buscado via HTTP real (`vite preview`, respeitando `base: /encanto/`): `start_url`,
  `scope`, `display` e os 2 ícones do array batem com o esperado; todos os 6 arquivos de ícone/favicon
  respondem 200.
- Boot real da app (Chromium desktop 1280×800): zero erros de console além do aviso já existente e
  esperado ("Supabase init erro: supabaseUrl is required", modo degradado por não haver `.env` de
  produção neste ambiente — não é regressão desta REF); `viewport` sem `maximum-scale` e com
  `viewport-fit=cover`; `theme-color`/`manifest`/`apple-touch-icon` presentes no DOM renderizado.
- 2 viewports mobile emulados via engine Chromium (412×915 "Android-like" e 390×844 "iPhone-like"):
  zero overflow horizontal, screenshot conferido visualmente — header, ícone, chips, cardápio renderizam
  normalmente, sem quebra de layout introduzida pela mudança de viewport/head.
- **20/20 checks automatizados passaram.**

**Camada manual (real device) — só é conclusiva com uma URL pública, portanto adiada para o
fechamento (pós-deploy), quando existe um HTTPS real para instalar de verdade:** Android Chrome, Samsung
Internet, Safari iOS não podem ser emulados com fidelidade suficiente a partir deste ambiente (o motor
WebKit do Playwright, mesmo se instalado, não reproduz o comportamento real de `safe-area-inset`/
"Adicionar à Tela de Início" do Safari iOS; não há emulador Android nem simulador iOS disponíveis aqui).
Checklist entregue ao dono na seção de Encerramento.

## Onda 6 — Service Worker

*(preenchida ao final da Onda 6)*

## Onda 7 — Testes finais

*(preenchida ao final da Onda 7)*

## Verificação (Ondas 1–4)

- `npm run build`: limpo após cada onda (3×).
- `npm run test:domain`: 29/29 verde após cada onda (3×) — nenhum arquivo de `src/` tocado por estas 3
  ondas, superfície de regressão real é zero.
- Manifest validado por leitura direta do `dist/encanto/manifest.json` gerado (paths absolutos batendo
  com `/encanto/`).
- `favicon.ico` validado carregando de volta via `System.Drawing.Icon` (arquivo estruturalmente correto).

## Limitações conhecidas

- `robots.txt` de verdade só pode ser resolvido no repositório da landing institucional
  (`valion-sistemas-site`), fora do alcance desta REF (D6).
- `apple-mobile-web-app-status-bar-style: default` deixa a barra de status do iOS com fundo próprio (não
  `black-translucent`/imersivo) — decisão consciente (D5), não limitação técnica.
- Sem screenshots no manifest (campo opcional `screenshots`, usado pelo Chrome/Android para uma UI de
  instalação mais rica) — não bloqueia a instalação, fica como possível melhoria futura (ver
  Recomendações).
- Nenhuma decisão de Capacitor desta REF foi implementada em código (D9) — são registros para quando o
  Capacitor for de fato adotado, propositalmente.

## Recomendações para futuras REFs

- Auto-hospedar a fonte Poppins (elimina a dependência de `fonts.googleapis.com`, útil para robustez
  offline real) — cogitada como Onda opcional desta REF, não priorizada.
- Adicionar `screenshots` ao manifest (Chrome/Android exibem uma prévia maior no diálogo de instalação)
  a partir de capturas reais do app.
- Quando o Capacitor for adotado: seguir D9 (1)-(5) como ponto de partida; nenhuma delas foi
  implementada aqui de propósito.
- Adicionar 1-2 projetos de emulação mobile (`devices['Pixel 7']`, `devices['iPhone 14']`) ao
  `e2e/playwright.config.js` — hoje só Desktop Chrome/Firefox/Safari são testados.
