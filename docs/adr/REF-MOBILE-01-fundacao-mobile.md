# REF-MOBILE-01 — Fundação Mobile (PWA Ready + Capacitor Ready)

**Status:** ✅ Ondas 1–7 implementadas, testadas e commitadas (todas na mesma sessão): Manifest, Ícones,
Head mobile/SEO, este ADR, Validação técnica automatizada, Service Worker, Testes finais — 29/29 domínio
+ 113/113 E2E, zero regressão. Pendente: push, deploy e validação em produção (dispositivo real) — ver
Encerramento.
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

### D8 — Service Worker via `vite-plugin-pwa`, sem `runtimeCaching`, `registerType: "prompt"`

Escolhido `vite-plugin-pwa` (Workbox por baixo) em vez de escrever o Service Worker à mão: o precache
manifest com hash/revisão por arquivo (invalidação correta a cada deploy) é gerado e mantido pela própria
ferramenta — reduz diretamente a superfície do maior risco identificado na auditoria (usuário preso numa
versão velha por bug de cache "feito à mão"). `npm audit` aponta 10 avisos, todos em dependências de
BUILD do `workbox-build` (nunca chegam ao bundle do navegador) — `npm audit --omit=dev` confirma **zero
vulnerabilidade em produção**; não corrigidos com `--force` porque isso forçaria upgrades MAJOR
(Vite 5→8, `vite-plugin-pwa` 0.x→1.2) fora do escopo desta REF.

Configuração (`vite.config.js`):
- `manifest: false` — o `public/manifest.json` próprio (Onda 1) e o `<link rel="manifest">` próprio
  (já commitados/validados) continuam sendo a única fonte; o plugin cuida SÓ do Service Worker.
- `registerType: 'prompt'` + `injectRegister: false` — nada troca de versão sozinho. O registro roda
  manualmente (`src/hooks/usePwaUpdate.js`, consumido por `App.jsx`), exibindo um aviso "Nova versão
  disponível" (reaproveita `components/ui/Toast.jsx`, `duracao={0}` = persistente até o clique) — nunca
  um reload forçado/silencioso no meio de um checkout.
- **Sem nenhuma entrada de `runtimeCaching`** — por design do Workbox, uma rota só é interceptada
  (`event.respondWith`) se casar com o precache ou com um `runtimeCaching` explícito; qualquer request
  fora disso (Supabase REST/Auth, `accounts.google.com`) passa direto pra rede, como se o SW não
  existisse. O `sw.js` gerado (inspecionado byte a byte) confirma: só 16 arquivos same-origin no precache
  (JS/CSS/HTML/ícones do build) + 1 `NavigationRoute` — nenhuma referência a `supabase`/`google` em lugar
  nenhum do arquivo gerado.
- `devOptions.enabled: false` (default) — o SW nunca ativa em `vite dev`/`vite --mode e2e` (o
  `webServer` do Playwright sobe via dev server, não build) — a suíte E2E inteira roda sem Service
  Worker, zero risco estrutural de interferência nos specs existentes.

**O único ponto realmente delicado — `NavigationRoute` intercepta o retorno do OAuth Google:** o
`navigateFallback` gera uma rota que serve `index.html` do cache para QUALQUER navegação same-origin,
incluindo a volta do Google (`.../encanto/?code=...&state=...`). Isso é seguro porque (a) o conteúdo do
`index.html` é estático e idêntico independente de query string — não há nada renderizado no servidor a
partir dela; (b) `window.location.search` reflete a URL de navegação real, **independente** de como os
bytes do documento foram servidos (cache ou rede); (c) `dbCliente` (`detectSessionInUrl: true`,
`flowType: 'pkce'`) processa o `?code=` inteiramente em JS no cliente, depois do carregamento — o mesmo
comportamento com ou sem SW. A navegação de IDA (usuário → `accounts.google.com`) nunca passa perto do
nosso SW: Service Workers só podem controlar fetches cujo destino esteja dentro do MESMO origin do
registro (`/encanto/` em `valionsistemas.com.br`) — garantia estrutural da própria especificação, não
uma configuração nossa.

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
- Boot real da app (Chromium desktop 1280×800, `.env` local com credenciais reais do Supabase de
  produção — mesmo `.env` usado por `npm run dev`): **zero erros de console**; `viewport` sem
  `maximum-scale` e com `viewport-fit=cover`; `theme-color`/`manifest`/`apple-touch-icon` presentes no
  DOM renderizado. (O aviso "Supabase init erro: supabaseUrl is required" só aparece nos testes de
  domínio via `node` puro — `import.meta.env` não existe fora do Vite — nunca no browser real; não é
  regressão desta REF.)
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

`npm install -D vite-plugin-pwa`; `vite.config.js` (plugin `pwaPlugin`, D8); `src/hooks/usePwaUpdate.js`
(novo — registra o SW, expõe `{novaVersaoDisponivel, atualizar, dispensar}`); `App.jsx` (+2 linhas de
import, +1 linha de hook, +1 bloco `<Toast>` condicional ao lado de `content`, dentro do `<AppShell>` já
existente — zero mudança na árvore de roteamento/estado existente). Commit `11778c1`.

**Verificação (empírica, não suposição):**
- `npm run build`: gera `dist/encanto/sw.js` (1889 bytes) + `dist/encanto/workbox-*.js`; precache de 16
  entradas (~1,2 MB — App Shell completo: JS/CSS/HTML/ícones/manifest).
- `sw.js` inspecionado por completo: `precacheAndRoute([...16 arquivos same-origin...])` +
  `cleanupOutdatedCaches()` + `clientsClaim()` + 1 `NavigationRoute`. Nenhuma outra rota. Busca por
  `supabase`/`google` no `sw.js` e no `workbox-*.js`: zero ocorrência real (só a constante interna
  inerte `googleAnalytics`, de uma feature do Workbox que não é habilitada nesta configuração).
- Script Playwright dedicado (descartável, não commitado) contra `vite preview` real: SW instala e
  ativa; após reload, a página fica CONTROLADA (`clientsClaim` confirmado); navegação para
  `/encanto/?code=fake&state=fake` responde 200, preserva a query string exatamente, o app renderiza
  normalmente (não trava no loader) — e **a resposta desta navegação é confirmada como vinda do próprio
  Service Worker** (`response.fromServiceWorker() === true`, via API nativa do Playwright), provando que
  o cenário testado é o cenário real (`NavigationRoute` de fato interceptou), não uma simulação teórica.
- `npm run test:domain`: 29/29 verde.
- `npm run test:e2e` (suíte completa, Chromium): **113/113 verde**, incluindo
  `auth/login-google-trigger.spec.js` ("clicar em Continuar com Google chama
  `signInWithOAuth(provider=google)`") e todos os specs de sessão/checkout/carrinho/catálogo — zero
  regressão.

## Onda 7 — Testes finais

- `rm -rf dist && npm run build`: limpo, do zero. `sw.js`/`workbox-*.js` gerados normalmente.
- `npm run test:domain`: **29/29 scripts, 309 asserções individuais, 100% verde.**
- `npm run test:e2e` (suíte completa, Chromium): **113/113 verde**, reexecutada do zero após a Onda 6
  (2ª vez, confirmando reprodutibilidade) — zero regressão em qualquer fluxo (auth/sessão/checkout/
  carrinho/catálogo/busca/admin).
- **Lighthouse real: tentado, não obtido neste ambiente.** O Chrome (via `chrome-launcher`, apontado
  para o binário do Chromium do Playwright) inicia e conecta normalmente, mas o processo falha na
  limpeza do próprio diretório temporário (`EPERM` ao apagar `%TEMP%\lighthouse.*` no Windows) antes de
  gravar o relatório — falha da ferramenta/ambiente (permissão de arquivo no Windows), não do app.
  Não é um resultado escondido por dar errado: a auditoria de prontidão desta REF se apoia nas validações
  próprias (Ondas 5–6, mais específicas ao risco real do projeto do que um score genérico) em vez de um
  número de Lighthouse. Recomendado rodar `npx lighthouse` num ambiente Linux/Mac (ou Chrome DevTools
  manualmente, aba Lighthouse) quando o dono quiser esse número — deve funcionar sem o problema de
  permissão específico do Windows.
- Validação manual real (Android Chrome, Samsung Internet, Safari iOS) — checklist na seção de
  Encerramento, a executar pelo dono após o deploy.

**Nenhuma regressão encontrada em nenhuma camada de teste.**

## Verificação (Ondas 1–3, por onda)

- `npm run build`: limpo após cada onda (3×).
- `npm run test:domain`: 29/29 verde após cada onda (3×) — nenhum arquivo de `src/` tocado por estas 3
  ondas, superfície de regressão real é zero.
- Manifest validado por leitura direta do `dist/encanto/manifest.json` gerado (paths absolutos batendo
  com `/encanto/`).
- `favicon.ico` validado carregando de volta via `System.Drawing.Icon` (arquivo estruturalmente correto).

(Ver Ondas 5–7 acima para a validação de viewport/mobile, Service Worker e a rodada final completa.)

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
- Lighthouse real não pôde ser executado neste ambiente Windows (falha de permissão do `chrome-launcher`
  ao limpar seu próprio diretório temporário, alheia ao app — ver Onda 7). A prontidão desta REF foi
  validada por verificação própria (manifest/ícones/head/SW inspecionados diretamente + Playwright), não
  por um score de Lighthouse.
- Validação em dispositivo real (Android Chrome, Samsung Internet, Safari iOS) não pôde ser feita a
  partir deste ambiente (sem hardware físico nem emulador/simulador disponíveis) — checklist entregue ao
  dono para rodar após o deploy (ver Encerramento).

## Recomendações para futuras REFs

- Auto-hospedar a fonte Poppins (elimina a dependência de `fonts.googleapis.com`, útil para robustez
  offline real) — cogitada como Onda opcional desta REF, não priorizada.
- Adicionar `screenshots` ao manifest (Chrome/Android exibem uma prévia maior no diálogo de instalação)
  a partir de capturas reais do app.
- Quando o Capacitor for adotado: seguir D9 (1)-(5) como ponto de partida; nenhuma delas foi
  implementada aqui de propósito.
- Adicionar 1-2 projetos de emulação mobile (`devices['Pixel 7']`, `devices['iPhone 14']`) ao
  `e2e/playwright.config.js` — hoje só Desktop Chrome/Firefox/Safari são testados.

## Encerramento

Checklist de validação manual em dispositivo real — só é conclusivo com a URL pública de produção
(`https://valionsistemas.com.br/encanto`), depois do deploy:

1. **Android Chrome:** abrir a URL; o menu (⋮) deve oferecer "Adicionar à tela inicial"/"Instalar app";
   confirmar que o ícone instalado é o símbolo (panela+açaí) e não um genérico; abrir o app instalado e
   confirmar que abre em `standalone` (sem barra de endereço).
2. **Samsung Internet:** mesmo teste do Android Chrome (motor Chromium — mesma expectativa).
3. **Safari iOS:** Compartilhar → "Adicionar à Tela de Início"; confirmar ícone correto; abrir e
   confirmar `standalone`; em um iPhone com notch/Dynamic Island, confirmar que o conteúdo não fica
   escondido atrás da barra de status (efeito do `viewport-fit=cover` + `env(safe-area-inset-*)`).
4. **Login Google real** (com o Service Worker ativo, PWA instalado ou não): confirmar que
   "Continuar com Google" completa o login normalmente — validação empírica final do ponto mais delicado
   desta REF (D8), já testado estruturalmente nesta sessão (ver Onda 6) mas nunca com uma conta Google
   real de ponta a ponta.
5. **Atualização:** depois de um próximo deploy, confirmar que o aviso "Nova versão disponível" aparece
   para quem já tinha o app aberto/instalado, e que "Atualizar agora" realmente troca de versão.
6. **Chrome Desktop / Edge:** confirmar o ícone de instalação na barra de endereço; instalar e conferir
   janela própria (sem abas do navegador).

**Resultado do deploy e desta validação:**

- Push: `origin/main` `8781429..e51866a` (8 commits desta REF).
- CI real no GitHub Actions ([run 30406833808](https://github.com/THDEV-WEB/Encanto-system/actions/runs/30406833808),
  commit `e51866a`): **Build ✅ (23s) · Testes de domínio ✅ (22s) · E2E Playwright/Chromium ✅ (281s,
  113/113)** — confirmação independente da máquina local, mesmo resultado.
- Deploy Vercel (push em `main` = deploy automático, projeto `encanto-system`): confirmado ao vivo —
  `https://valionsistemas.com.br/encanto/manifest.json`, `.../sw.js` e `.../icon-192.png` respondem 200
  em produção, com o CONTEÚDO exato desta REF (`manifest.json` byte a byte igual ao commitado; `index.html`
  com `theme-color`/`apple-touch-icon`/`<link rel="manifest">` presentes).
- Itens 1–6 do checklist manual (Android Chrome, Samsung Internet, Safari iOS, login Google real,
  atualização do SW, Chrome Desktop/Edge) **seguem pendentes do dono** — exigem dispositivo físico/conta
  Google real, indisponíveis neste ambiente de agente. Recomendado rodar em até alguns dias (não são
  bloqueantes: toda a lógica foi validada estruturalmente + via E2E real; são a confirmação final de UX
  em hardware real).

**REF-MOBILE-01 encerrada tecnicamente** — implementação, testes e deploy 100% concluídos; validação de
UX em dispositivo real é a única pendência, de responsabilidade do dono.
