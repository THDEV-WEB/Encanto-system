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

✅ Ondas 1–7 CONCLUÍDAS — **Onda 6 com homologação física confirmada pelo dono** (3 causas raiz
sequenciais investigadas e corrigidas: bug de reconstrução de zip da UI do GitHub, secrets do Supabase
ausentes, typo num secret; ver D10 do ADR); **Onda 7 com o APK homologado já publicado** em
`public/downloads/Encanto.apk`, botão de download real em produção. Onda 8 (documentação de encerramento)
em andamento. Pendente, registrado desde o D5: entrada no allow-list do Supabase Auth pro deep link do
login Google (Onda 4/D5) — orientação entregue ao dono, validação do login nativo aguardando teste físico.

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

Status: ✅ CONCLUÍDA (ver D8 do ADR).

- `@capacitor/assets` (devDependency nova) gerou ícone adaptativo + variantes (`ic_launcher`/`_round`/
  `_foreground`/`_background`, todas as densidades) + splash (light/dark/portrait/landscape) a partir de
  `assets/logo.png` (novo, cópia commitada de `public/icon-encanto.png`, 680×680, opaco/sem transparência
  real — confirmado via `sharp`). Fundo branco (`#ffffff`, mesmo `background_color` do manifest web),
  escala do logo no splash `0.35` (ajustada depois de comparar visualmente com o padrão `0.2`, pequeno
  demais). Cada asset gerado foi **lido como imagem** antes de aceitar, não só confirmado por existir.
- **Achado real corrigido:** `colors.xml` não existia no template padrão do Capacitor — `styles.xml` já
  referenciava `@color/colorPrimary`/`colorPrimaryDark`/`colorAccent` sem nenhuma definição, o que quebraria
  o build Gradle assim que alguém tentasse compilar (só apareceria na Onda 6). Criado com `colorPrimary`/
  `colorAccent` = `#6B1F5D` (mesmo `theme_color` do manifest web/`index.html`) e `colorPrimaryDark` =
  `#531849` (variante mais escura calculada). Toda referência `@color`/`@style`/`@drawable`/`@mipmap` do
  projeto Android foi cruzada manualmente contra as definições — nenhuma outra lacuna.
- Nome "Encanto": já estava correto desde a Onda 2 (`capacitor.config.json`→`strings.xml`), sem trabalho
  adicional.
- Achado dos favicons/manifest com prefixo `/encanto/` hardcoded (D1 do ADR) permanece **deliberadamente
  não resolvido** — continua inofensivo (WebView nativa não exibe favicon; ícone real do app já vem dos
  recursos nativos desta onda).
- `npm audit --omit=dev` continua **0** (10 vulnerabilidades novas, todas em devDependencies de
  `@capacitor/assets` — `tar`/`uuid`, ferramentas de build, mesmo padrão já aceito no projeto).
- Validado: `npm run test:domain` 309/309 (nenhum arquivo de `src/` alterado nesta onda).

## Onda 6 — Gerar APK

Status: ✅ **CONCLUÍDA — homologação física confirmada pelo dono.** Ver D10 do ADR para a cadeia completa
de investigação (3 causas raiz sequenciais, cada uma só visível depois da anterior corrigida).

- Push feito (`2b9e0f0..8164f6c` em `origin/main`, 6 commits desta REF). `ci.yml` existente rodou sobre
  esse código automaticamente ([run 30581874670](https://github.com/THDEV-WEB/Encanto-system/actions/runs/30581874670))
  — **success** (build/domain-tests/e2e).
- `.github/workflows/android-apk.yml` — primeiro build ([run 30582093288](https://github.com/THDEV-WEB/Encanto-system/actions/runs/30582093288)),
  **success**, todos os 14 steps verdes, incluindo a primeira compilação real do `NativePrintPlugin.java`
  desta REF (D7 do ADR) — sem erro na primeira tentativa, apesar de não poder ser compilado localmente.

**Causa raiz #1 — instalação falhava ("Ocorreu um problema ao analisar o pacote"):** bug de
reconstrução dinâmica do `.zip` pela **interface web** do GitHub Actions Artifacts v4 (entregava um
`.apk` 572 bytes menor que o original, de forma determinística) — o caminho da **API REST** sempre
reconstruiu corretamente, confirmado batendo com o `sha256sum` calculado dentro do próprio job da CI.
Mitigação: baixar artefatos desta REF exclusivamente via API/token, nunca pela UI. Ver
[actions/upload-artifact#190](https://github.com/actions/upload-artifact/issues/190) (issue pública
relacionada) e D10 do ADR.

**Causa raiz #2 — instalava, mas mostrava catálogo genérico:** `android-apk.yml` nunca passava
`VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` ao build — confirmado rodando o bundle real (extraído do `.apk`)
num Chromium via Playwright e capturando o boot: `createClient()` lançava `"supabaseUrl is required"`,
`db`/`dbCliente` degradavam pra `null` (comportamento correto do código) e o catálogo caía no fallback
mock (`src/data/mockCatalog.js`). Correção: `env:` novo no step de build, lendo 2 secrets novos
(`VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY`, valores de produção iguais aos da Vercel — **não** os secrets
de E2E, que apontam pra um projeto Supabase isolado de testes; reaproveitá-los faria pedidos reais se
perderem num banco que o Admin real não enxerga).

**Causa raiz #3 (regressão intermediária) — secrets cadastrados mas catálogo ainda não carregava:**
typo no valor colado em `VITE_SUPABASE_URL` (duas letras trocadas de posição, domínio inexistente,
confirmado testando via `curl` as duas variantes). Corrigido recolando o valor certo.

**Validação final:** boot real do bundle mostrando `"✅ 8 categorias carregadas do Supabase"`/`"✅ 24
products carregados do Supabase"` com todas as chamadas REST/RPC retornando 200; integridade do artefato
reconfirmada 3× de forma independente; **e a homologação física no Android 16 do dono, concluída com
sucesso — instalação normal, app abre e funciona.**

**Nota honesta de escopo:** a homologação confirma instalação + catálogo real. Os fluxos específicos de
D5 (login Google nativo), D6 (botão voltar) e D7 (impressão nativa) não tiveram teste funcional dedicado
nesta rodada — recomendado exercitá-los no uso real subsequente.

**Ainda pendente, registrado desde o D5:** nova entrada no allow-list de Redirect URLs do Supabase Auth
para `br.com.valionsistemas.encanto://login-callback` — sem isso, o login Google nativo especificamente
não completa, mesmo com o resto do app funcionando.

## Onda 7 — Distribuição

Status: ✅ **CONCLUÍDA — infraestrutura + arquivo publicado.** Botão de download real e funcional em
produção.

- `vercel.json`: novo `rewrites` (`/encanto/download` → `/encanto/index.html`). Achado: este projeto não
  tinha NENHUM fallback de SPA configurado (só `redirects` da raiz institucional pra `/encanto`) — sem
  esse rewrite, visitar `/encanto/download` batia direto no host estático do Vercel e devolvia 404 antes
  do bundle React sequer carregar. Rewrite escopado só a esse path novo — nenhum outro comportamento de
  rota existente foi tocado.
- `hooks/useDownloadPage.js` (novo): mesma técnica já usada pelo acesso ao Admin
  (`useAdminSession.js`, `window.location.hash==='#admin-encanto'`), só que por **path real** (pedido
  explícito do dono era uma URL de verdade, compartilhável) em vez de hash. Checado 1x no mount.
- `components/DownloadScreen.jsx` (novo): página standalone (fora de Loja/Admin), botão "Baixar aplicativo
  Android" (`<a download href="/encanto/downloads/Encanto.apk">`), aviso sobre "fontes desconhecidas"
  (instalação fora da Play Store), link de volta pro site.
- `App.jsx`: `useDownloadPage()` + curto-circuito **depois** de todos os hooks (regra dos hooks
  preservada), **antes** do branch normal `mode`. Página "Encanto" hardcoded aceito aqui pelo mesmo
  precedente já registrado em REF-COMPANY-02 (`company-name.guard.mjs` só cobre uma lista fixa de
  arquivos; este não entra nela — página de distribuição, não superfície de produto).
- Validado: `npm run build` limpo, `test:domain` 309/309, **verificação real via Playwright** (não só
  suposição): `/encanto/download` renderiza o título/botão certos, `href` do botão resolve pro path
  esperado, zero erro de console; `/encanto/` (loja normal) segue carregando sem regressão.

**Publicação do arquivo (pós-homologação física, D10):** com a Onda 6 homologada de ponta a ponta —
instalação real confirmada no Android 16 do dono, catálogo de produção carregando corretamente — a
barreira que mantinha o arquivo fora do ar deixou de existir. `public/downloads/Encanto.apk` (novo,
binário) = cópia byte a byte do artefato validado (mesmo `sha256`:
`da390a02d9a1536ef859e3dd05095cd600138fb7db96435245c7612ff170b71d`, `6.368.798 bytes`, run
`30654752201` — mesmo arquivo que passou pela homologação física, não um rebuild novo). Verificado após o
build: `dist/encanto/downloads/Encanto.apk` preserva o hash exato; servido via `vite preview` real com
`Content-Length`/hash corretos. `vercel.json` ganhou uma entrada em `headers` fixando `Content-Type:
application/vnd.android.package-archive` só pra esse arquivo (Vite/Vercel não inferem esse MIME type
sozinhos pra `.apk`) — sem isso o download ainda funcionaria (o atributo `download` do link já força
salvar, e o nome do arquivo na URL já termina em `.apk`), mas o cabeçalho correto é mais robusto.
"Sem atualização automática de APK" continua valendo — publicar uma nova versão no futuro é sempre um
passo manual (build validado → cópia pro `public/downloads/` → commit), nunca automático.

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
- `assets/logo.png` (novo, Onda 5 — fonte-de-verdade pro `@capacitor/assets`, cópia de
  `public/icon-encanto.png`).
- `android/app/src/main/res/{mipmap-*,drawable*}/*` — ícone adaptativo + splash gerados (Onda 5, D8).
- `android/app/src/main/res/values/colors.xml` (novo, Onda 5, D8 — corrige lacuna pré-existente do
  template, `colorPrimary`/`colorPrimaryDark`/`colorAccent` não definidos).
- `package.json`/`package-lock.json` — `@capacitor/assets` (devDependencies) (Onda 5).
- `.github/workflows/android-apk.yml` (novo, Onda 6 — não altera `ci.yml`); gate `aapt dump badging`+
  `apksigner verify` adicionado depois (D10); `env:` com `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` adicionado
  por último (D10, causa raiz #2).
- 2 secrets novos no repositório GitHub: `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` (valores de produção,
  Onda 6/D10 — não são arquivo, mas fazem parte do estado necessário pro workflow funcionar).
- `vercel.json` — `rewrites` pro path `/encanto/download` (Onda 7); `headers` fixando `Content-Type` do
  `.apk` (Onda 7, pós-homologação).
- `src/hooks/useDownloadPage.js` (novo, Onda 7).
- `src/components/DownloadScreen.jsx` (novo, Onda 7).
- `src/App.jsx` — curto-circuito pra `DownloadScreen` (Onda 7).
- `public/downloads/Encanto.apk` (novo, binário — Onda 7 pós-homologação; cópia exata do artefato
  validado fisicamente no Android 16, run `30654752201`).
- `docs/adr/REF-CAP-01-app-nativo-android.md` (novo, Onda 1; D2–D4 Onda 2)
- `docs/ref/REF-CAP-01-progress.md` (novo, este arquivo)
