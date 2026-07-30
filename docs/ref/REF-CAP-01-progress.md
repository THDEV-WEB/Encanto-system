# REF-CAP-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui — não
repetir trabalho já concluído abaixo.

**Contexto:** auditoria completa (Fase 1) apresentada e **aprovada pelo dono em 2026-07-30**, com 3
observações para a execução: (1) evitar duplicação desnecessária da config do Vite no Dual Build; (2)
garantir que toda lógica específica do Capacitor fique isolada da execução Web/PWA; (3) documentar
tecnicamente a decisão do novo fluxo Google OAuth (Browser + Deep Link + PKCE) antes de implementá-lo —
ver Onda 4. Ver auditoria completa e D1 em
[`docs/adr/REF-CAP-01-app-nativo-android.md`](../adr/REF-CAP-01-app-nativo-android.md).

## Estado atual

🚧 Ondas 1–4 CONCLUÍDAS (código; Onda 3 sem trabalho adicional — ver D3 do ADR; validação real da Onda 4
em dispositivo físico fica pra Onda 6). Ondas 5–8 pendentes.

## Onda 1 — Dual Build

Status: ✅ CONCLUÍDA.

- `vite.config.js`: convertido para a forma função (`defineConfig(({mode}) => …)`), gate único
  `mode==='capacitor'`. Fora desse modo, comportamento **byte a byte idêntico** a antes (hashes de JS/CSS
  conferidos). Dentro do modo `capacitor`: `base:'/'`, `outDir:'dist/capacitor'`, Service Worker desligado
  via `VitePWA({disable:true})` (plugin continua no array — só assim `virtual:pwa-register`, importado por
  `src/hooks/usePwaUpdate.js`, continua resolvendo; removê-lo do array quebra o build).
- `package.json`: 2 scripts novos, `build:capacitor` (`vite build --mode capacitor`) e `preview:capacitor`
  (`vite preview --mode capacitor`). Nenhum script existente alterado.
- `.gitignore`: nenhuma mudança necessária — `dist` (sem barra, já cobre qualquer subpasta) já ignorava
  `dist/encanto`; passa a ignorar `dist/capacitor` do mesmo jeito.
- Validado: `npm run build` (hashes idênticos ao build anterior à REF) + `npm run build:capacitor` (sem
  erro, sem `sw.js`, assets em `/assets/...` sem prefixo) + `npm run preview:capacitor` servindo os
  arquivos reais (`curl` + `Content-Type`/`Content-Length` confirmando arquivo real vs. fallback de SPA) +
  `npm run test:domain` 309/309 (zero regressão).
- Achado documentado (D1 do ADR, não bloqueia): favicons/manifest/apple-touch-icon em `index.html` têm o
  prefixo `/encanto/` escrito à mão — inofensivo dentro do Capacitor (sem chrome de navegador pra exibir
  favicon; ícone real do app vem de recursos nativos gerados na Onda 5), mas registrado para transparência.

## Onda 2 — Integração do Capacitor

Status: ✅ CONCLUÍDA.

- Instalado `@capacitor/core` (`dependencies`) + `@capacitor/cli` (`devDependencies`) + `@capacitor/
  android` (`dependencies`, convenção oficial do Capacitor) — versão **8.4.2** (atual). `npm audit`: 10
  vulnerabilidades (1 moderada, 9 altas), todas em devDependencies — `npm audit --omit=dev` = **0** (mesmo
  padrão já usado para `vite-plugin-pwa`).
- `npx cap init "Encanto" "br.com.valionsistemas.encanto" --web-dir=dist/capacitor` → `capacitor.config.
  json` (`appId`/`appName`/`webDir` — ver D2 do ADR pro racional do `appId`).
- `npx cap add android` → projeto nativo em `android/` (commitado, como é convenção do Capacitor — só
  `node_modules` fica de fora). O próprio template já traz `android/.gitignore` cobrindo `build/`,
  `.gradle/`, `local.properties` (path do SDK, específico de cada máquina) e os artefatos que `cap sync`
  regenera sozinho (web assets copiados, `capacitor.config.json`/`capacitor.plugins.json` internos) — nada
  extra precisou ser adicionado.
- `npx cap sync android` → copia `dist/capacitor` para `android/app/src/main/assets/public` + regenera
  `capacitor.settings.gradle`/`capacitor.build.gradle`. **Achado corrige a Fase 1:** esse passo NÃO invoca
  Gradle/JDK de verdade (só cópia de arquivo + geração de config) — rodou sem erro apesar da ausência de
  Java nesta máquina. Ver D4 do ADR: a falta de toolchain só bloqueia a COMPILAÇÃO real (Onda 6), não a
  integração.
- Validado: `npm run build` (web) com hash de JS idêntico ao anterior (Capacitor instalado não entra no
  bundle web, nada o importa) + `npm run test:domain` 309/309 — zero regressão.

## Onda 3 — Projeto Android

Status: ✅ CONCLUÍDA — **sem trabalho adicional** (ver D3 do ADR). O template do Capacitor 8.4.2 já gera
o projeto com `compileSdkVersion`/`targetSdkVersion` **36** (Android 16, atual), `minSdkVersion` **24**,
Android Gradle Plugin **8.13.0**, Gradle wrapper **8.14.3**, `android.useAndroidX=true`, Java
**21** — todos objetivamente as versões recomendadas atuais, confirmados lendo os arquivos gerados
(`android/variables.gradle`, `android/build.gradle`, `android/gradle/wrapper/gradle-wrapper.properties`,
`android/gradle.properties`, `android/app/capacitor.build.gradle`). Resolve diretamente a motivação do
Play Protect, sem nenhum bump manual de versão.

## Onda 4 — Integração nativa

Status: ✅ CONCLUÍDA (código). Validação real (dispositivo físico) reservada para a Onda 6.

- **OAuth Google nativo (D5 do ADR):** `AuthService.signInWithGoogle()` ganhou branch
  `Capacitor.isNativePlatform()` → `signInWithGoogleNativo()` (nova, privada): `signInWithOAuth({...,
  skipBrowserRedirect:true})` + `Browser.open()` (navegador do sistema) + `CapacitorApp.addListener(
  'appUrlOpen', …)` (deep link `br.com.valionsistemas.encanto://login-callback`) +
  `exchangeCodeForSession(code)` manual. `AndroidManifest.xml`: novo `intent-filter` no `MainActivity`
  (mesmo `launchMode="singleTask"` já existente). Web/PWA **inalterado** (branch nunca entra ali).
  Pendente, passo do dono: nova entrada no allow-list de Redirect URLs do Supabase Auth.
- **Botão físico "voltar" (D6 do ADR):** `hooks/useCapacitorBackButton.js` (novo), registrado em
  `App.jsx`. `StoreApp.jsx` e `StoreMenu.jsx` ganharam `forwardRef`/`useImperativeHandle` (resumo
  imperativo do que já está aberto — nenhum estado movido/renomeado). Prioridade: admin/login → volta pra
  loja; dentro da loja, fecha modal/carrinho/fidelidade/menu (o que estiver por cima); nada aberto → sai
  do app. Limitação aceita conscientemente: painel Admin não expõe resumo próprio (voltar sempre sai pra
  loja) — fora do escopo pedido para esta onda.
- **Permissão de geolocalização:** `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` no
  `AndroidManifest.xml`. Sem mudança de código JS — a Bridge do Capacitor já intercepta o prompt de
  geolocalização da WebView automaticamente quando a permissão existe no manifest.
- **Impressão nativa (D7 do ADR):** `NativePrintPlugin.java` (novo, plugin Capacitor LOCAL — não é pacote
  npm), registrado em `MainActivity.java`. `src/lib/nativePrint.js` (novo, ponte JS via `registerPlugin`).
  `printComanda.js` ganhou branch `Capacitor.isNativePlatform()` — caminho do iframe/`window.print()`
  **intocado** pro navegador/PWA. **Risco assumido e comunicado:** código Java segue a receita oficial da
  Android (`WebView.createPrintDocumentAdapter`+`PrintManager`) mas não pôde ser compilado nesta máquina
  (sem JDK/SDK) — validação real fica pra Onda 6.
- Validado: `npm run build` (web, hash de bundle mudou — esperado, `~10 KB` gzip a mais dos 3 plugins
  Capacitor agora usados por `AuthService.js`/`printComanda.js`, nunca executados no navegador) +
  `npm run build:capacitor` + `npx cap sync android` (detectou `@capacitor/app`+`@capacitor/browser`
  automaticamente) + `npm run test:domain` 309/309 — zero regressão.

## Onda 5 — Assets

Status: ⏳ PENDENTE. Ícone adaptativo + splash gerados de `public/icon-encanto.png` (680×680, via
`@capacitor/assets`), nome "Encanto", tema `#6B1F5D`. Resolver também o achado dos favicons/manifest com
prefixo `/encanto/` hardcoded (ver D1 do ADR) se ainda fizer sentido nesse ponto.

## Onda 6 — Gerar APK

Status: ⏳ PENDENTE. `Encanto.apk` via GitHub Actions (Android SDK pré-instalado no runner
`ubuntu-latest` — workflow novo, sem alterar `.github/workflows/ci.yml`). Teste em dispositivo físico:
instalação, login, pedidos, admin, upload, geolocalização, impressão. Confirmar ausência de alerta do
Play Protect.

## Onda 7 — Distribuição

Status: ⏳ PENDENTE. Rota `/encanto/download` + botão "Baixar aplicativo Android". Sem atualização
automática de APK nesta REF.

## Onda 8 — Documentação

Status: ⏳ PENDENTE. Consolidar ADR/progress, registrar as 3 formas oficiais de uso (Navegador/PWA/APK).

## Arquivos modificados até aqui

- `vite.config.js` — Dual Build (Onda 1).
- `package.json`/`package-lock.json` — scripts `build:capacitor`/`preview:capacitor` (Onda 1);
  `@capacitor/core`+`@capacitor/android` (dependencies) e `@capacitor/cli` (devDependencies) (Onda 2);
  `@capacitor/browser`+`@capacitor/app` (dependencies) (Onda 4).
- `src/services/AuthService.js` — `signInWithGoogleNativo()` + branch de plataforma (Onda 4, D5).
- `src/hooks/useCapacitorBackButton.js` (novo, Onda 4, D6).
- `src/pages/StoreApp.jsx`/`src/components/menu/StoreMenu.jsx` — `forwardRef`/`useImperativeHandle`
  (resumo de estado pro botão voltar, Onda 4, D6).
- `src/App.jsx` — `useCapacitorBackButton` + `ref` pro `StoreApp` (Onda 4, D6).
- `src/lib/nativePrint.js` (novo, Onda 4, D7).
- `src/components/admin/comanda/printComanda.js` — branch de plataforma (Onda 4, D7).
- `android/app/src/main/AndroidManifest.xml` — `intent-filter` do deep link de login + permissões de
  geolocalização (Onda 4).
- `android/app/src/main/java/br/com/valionsistemas/encanto/NativePrintPlugin.java` (novo, Onda 4, D7).
- `android/app/src/main/java/br/com/valionsistemas/encanto/MainActivity.java` — registro do
  `NativePrintPlugin` (Onda 4, D7).
- `capacitor.config.json` (novo, Onda 2)
- `android/` (novo, Onda 2 — projeto nativo gerado pelo Capacitor, commitado por convenção)
- `docs/adr/REF-CAP-01-app-nativo-android.md` (novo, Onda 1; D2–D4 Onda 2)
- `docs/ref/REF-CAP-01-progress.md` (novo, este arquivo)
