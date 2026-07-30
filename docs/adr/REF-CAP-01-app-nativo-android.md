# REF-CAP-01 — Aplicativo Android Nativo (Capacitor)

**Status:** 🚧 Em execução. Fase 1 (auditoria) apresentada e **aprovada pelo dono em 2026-07-30**. Onda 1
(Dual Build) implementada, testada e validada (este commit). Ondas 2–8 pendentes.
**Depende de:** [REF-MOBILE-01](REF-MOBILE-01-fundacao-mobile.md) (fundação PWA — manifest/ícones/Service
Worker; sua D9 já reservava a estratégia "Capacitor-Ready" que esta REF agora executa) e
[REF-BRAND-01](REF-BRAND-01-dominio-institucional.md) (`base:'/encanto/'`, sub-path institucional —
motivo direto do conflito resolvido na D1 abaixo).
**Relacionado:** NÃO substitui o navegador nem o PWA — adiciona uma **terceira** forma oficial de uso
(APK Android nativo). Não contempla publicação em loja (Play Store); reservado para REF futura.

## Objetivo

Gerar um aplicativo Android nativo via Capacitor, preservando 100% da arquitetura, regras de negócio,
Supabase, autenticação por e-mail, Sentry, CI existente e a estrutura de `StoreApp`. Ao final, o Encanto
passa a ter três formas de uso oficiais: 🌐 Navegador, 📲 PWA, 📦 APK Android.

## Motivação adicional

Testes reais da REF-MOBILE-01 mostraram que, em alguns aparelhos, a instalação do PWA pode disparar um
alerta do Google Play Protect ("aplicativo criado para versões antigas do Android"). Causa real: o
mecanismo do próprio navegador ao empacotar o PWA como WebAPK, não o projeto — mas um APK gerado
diretamente pelo Capacitor elimina essa dependência, porque `compileSdkVersion`/`targetSdkVersion`/Gradle
passam a ser configurados diretamente por nós (Onda 3), em vez de herdados da decisão do navegador.

## Auditoria (Fase 1 — aprovada pelo dono em 2026-07-30)

Levantamento completo do repositório (sem nenhuma mudança de código), cobrindo cada item pedido:

- **Arquitetura de navegação:** sem `react-router`; SPA 100% *state-driven* (`useAdminSession` →
  `mode:'store'|'login'|'admin'`), com uma única exceção de hash (`#admin-encanto`) para entrada no
  admin. Ideal para Capacitor — zero rota de servidor para preservar.
- **OAuth Google — risco crítico:** `AuthService.signInWithGoogle()` faz `signInWithOAuth` com redirect
  **dentro da própria WebView**. Google **bloqueia ativamente** login OAuth quando detecta User-Agent de
  WebView embutida (política desde 2021) — vai falhar tal como está hoje dentro do APK. Mitigação
  planejada para a Onda 4: abrir o OAuth no navegador do sistema (`@capacitor/browser`) + capturar o
  retorno via deep link (`App.addListener('appUrlOpen', …)`) + `dbCliente.auth.exchangeCodeForSession
  (code)` manual. `flowType:'pkce'` (já ativo em `dbCliente.js`) sustenta essa troca manual sem mudar o
  fluxo de e-mail OTP (`signInWithEmailOtp`/`verifyEmailOtp`, sem redirect, não afetado).
- **`base:'/encanto/'` vs. `webDir` do Capacitor — risco crítico, resolvido nesta onda:** o build web
  gera referências absolutas `/encanto/...` (necessário para o proxy institucional). O Capacitor serve o
  **conteúdo** de `webDir` na raiz local do WebView — as duas convenções colidiam (assets 404ariam dentro
  do APK). Ver D1.
- **Redirect do Supabase Auth:** vai precisar de nova entrada no allow-list de Redirect URLs (mesmo
  mecanismo já usado em REF-AUTH-01/REF-BRAND-01) — configuração do projeto, não código.
- **Botão físico "voltar":** sem tratamento, o Capacitor fecha o app por padrão (sem histórico de
  navegação, já que tudo aqui é *state*, não URL) — precisa de listener dedicado na Onda 4.
- **Toolchain Android:** confirmado — **não há Java, Android SDK, Gradle nem `adb`** nesta máquina.
  Recomendação: gerar o APK via GitHub Actions (`ubuntu-latest`, que já vem com Android SDK
  pré-instalado), workflow **novo**, sem alterar `.github/workflows/ci.yml` existente.
- **Geolocalização:** `navigator.geolocation` (busca de endereço, `useAddressSearch.js`) funciona na
  WebView, mas precisa de `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` declaradas no
  `AndroidManifest.xml` (Onda 4).
- **Upload:** `<input type="file">` (`ImageUploader.jsx`, admin) funciona nativamente na WebView do
  Capacitor, sem plugin adicional.
- **Impressão:** comanda térmica via iframe/`window.print()` (`printComanda.js`) — sem diálogo nativo
  garantido em WebView Android sem plugin dedicado; validação própria na Onda 4 (o APK inclui o admin).
- **Service Worker:** sem função útil dentro de um APK empacotado localmente (não existe "novo deploy via
  rede" nesse modelo) — desativado condicionalmente na D1, sem alterar o comportamento web/PWA.
- **Ícones/assets:** `public/icon-encanto.png` (680×680) suficiente para gerar todo o conjunto Android via
  `@capacitor/assets` (Onda 5).
- **iOS futuro:** exige Mac/Xcode — fora do alcance desta máquina; a camada Capacitor/JS é reutilizável,
  mas não desbloqueada por esta REF (Android-only).

## Decisões

### D1 — Dual Build: `mode` do Vite dentro de UM SÓ `vite.config.js`, nunca um arquivo paralelo

**Problema:** o build web (`base:'/encanto/'`, `outDir:'dist/encanto'`, Service Worker via
`vite-plugin-pwa`) é incompatível com o modelo de `webDir` do Capacitor por dois motivos independentes:

1. `base:'/encanto/'` faz o `index.html` referenciar assets em `/encanto/assets/...`. O Capacitor serve o
   **conteúdo** da pasta apontada por `webDir` na raiz do WebView local (`https://localhost/`) — um
   arquivo em `dist/encanto/assets/x.js` fica acessível em `https://localhost/assets/x.js`, não em
   `https://localhost/encanto/assets/x.js`. Sem correção, **todo JS/CSS 404aria dentro do APK**.
2. Um Service Worker Workbox pressupõe "nova versão = novo fetch de rede" — dentro de um APK empacotado
   localmente essa premissa não existe (nova versão = novo APK instalado). Gerar um `sw.js` dentro do
   `webDir` do Capacitor seria, na melhor hipótese, inerte; na pior, uma fonte de confusão de cache.

**Alternativas consideradas:**
- Um `vite.config.capacitor.js` totalmente separado — descartado: duplicaria plugins/lógica do Sentry/
  release e criaria risco real de as duas configs divergirem em silêncio ao longo do tempo (exatamente o
  tipo de duplicação que o dono pediu para evitar).
- Trocar `base` só via variável de ambiente lida em runtime — descartado: o Capacitor precisa do build já
  pronto com o `base` certo; não há "runtime" para decidir isso depois de gerado.

**Decisão:** um único `vite.config.js`, usando a função de configuração do Vite (`defineConfig(({mode}) =>
…)`) com um único gate: `mode === 'capacitor'` (invocado via `vite build --mode capacitor`, novo script
`npm run build:capacitor`). Fora desse modo explícito — todo o resto do projeto, sem exceção (`npm run
build`/`dev`/`preview`/E2E) — o resultado é **byte a byte idêntico** a antes desta REF (confirmado:
mesmos hashes `index-C4le4we3.css`/`index-CdahV6I0.js`). Dentro do modo `capacitor`:
- `base:'/'` e `outDir:'dist/capacitor'` (pasta irmã de `dist/encanto`, nunca sobrepõe).
- Service Worker desativado via `VitePWA({ disable: true, … })` — a MESMA chave que já desliga o plugin em
  dev (`devOptions.enabled:false` já era o padrão). Importante: o plugin continua **presente** no array de
  `plugins` (só desativado), porque `src/hooks/usePwaUpdate.js` faz `import('virtual:pwa-register')` — é
  o próprio `vite-plugin-pwa` quem fornece esse módulo virtual. Removê-lo do array por completo (tentativa
  inicial) quebra o build (`Rollup failed to resolve import "virtual:pwa-register"`). Com `disable:true` o
  módulo virtual continua resolvendo como stub *no-op* — o hook roda normalmente e nunca ativa nada, zero
  mudança de código em runtime.

**Validação:**
- `npm run build` (web): hashes de JS/CSS idênticos aos do build anterior a esta REF — zero regressão.
- `npm run build:capacitor`: `dist/capacitor/` gerado com `base:'/'`; nenhum `sw.js`/`workbox-*.js`
  gerado; `index.html` referenciando `/assets/...` (sem prefixo `/encanto/`).
- `npm run preview:capacitor` (novo script, `vite preview --mode capacitor`) servindo `dist/capacitor/`:
  confirmado via `curl` + inspeção de `Content-Type`/`Content-Length` que `/assets/index-*.js` e
  `/assets/index-*.css` respondem como arquivos reais (não fallback de SPA), e que o antigo caminho
  `/encanto/assets/...` e `/sw.js` **não existem de verdade** (a resposta 200 que aparentam é só o
  fallback de SPA do `vite preview` servindo `index.html` — em uma WebView real do Capacitor, sem esse
  middleware, seriam 404 verdadeiros).
- `npm run test:domain`: 309/309 asserções, sem regressão.

**Achado observado, deliberadamente adiado para a Onda 5:** os `<link rel="icon">`/`<link rel=
"manifest">`/`<link rel="apple-touch-icon">` em `index.html` têm o prefixo `/encanto/` **escrito à mão**
no texto-fonte (não gerado pelo mecanismo de `base` do Vite) — dentro do build Capacitor eles continuam
apontando para `/encanto/favicon-...`, que não existe na raiz servida. Na prática isso é inofensivo: um
WebView nativo sem chrome de navegador não exibe favicon nenhum, e o ícone real do app Android vem de
recursos nativos (`mipmap-*`, gerados por `@capacitor/assets` na Onda 5), não desses `<link>`. Registrado
aqui para transparência; não é um bloqueio da Onda 1.

### D2 — `appId` do Android: `br.com.valionsistemas.encanto`

**Decisão:** reverse-DNS **estrito** do domínio institucional que o dono realmente possui
(`valionsistemas.com.br` → `br.com.valionsistemas`), com o app como último segmento (`.encanto`) — mesmo
padrão recomendado pela própria documentação do Android para quem já tem um domínio próprio. Alternativas
mais comuns na prática (`com.valionsistemas.encanto`, ignorando o `.br`) foram descartadas por serem menos
formalmente corretas sem nenhum ganho real.

**Por que decidir agora, e não perguntar:** o `applicationId` é tecnicamente barato de trocar **nesta
fase** (nenhum APK publicado, nenhuma instalação real em campo) — mudar depois de publicado é que seria
caro (Play Store trataria como um app novo). Registrado aqui de forma explícita e reversível, não como
decisão de produto silenciosa.

### D3 — Onda 3 ("versões modernas") já vem satisfeita pelo template do Capacitor 8.x

A auditoria da Fase 1 previu uma Onda 3 dedicada a atualizar `compileSdkVersion`/`targetSdkVersion`/
AndroidX/Gradle manualmente. Na prática, `npx cap add android` do Capacitor **8.4.2** (a versão mais
recente, instalada nesta REF) já gera o projeto com:

- `compileSdkVersion`/`targetSdkVersion` = **36** (Android 16, a API mais recente) — resolve diretamente a
  motivação do Play Protect.
- `minSdkVersion` = **24** (Android 7.0) — piso razoável, cobre a esmagadora maioria dos aparelhos ativos.
- Android Gradle Plugin **8.13.0** + Gradle wrapper **8.14.3** (`android/gradle/wrapper/gradle-wrapper.
  properties`) — ambos atuais.
- `android.useAndroidX=true` (`android/gradle.properties`) + todas as libs AndroidX em versões recentes
  (`variables.gradle`).
- `sourceCompatibility`/`targetCompatibility` Java **21** (`capacitor.build.gradle`).

**Decisão:** não fazer nenhum bump manual de versão — usar os defaults do template tal como vieram, já que
são objetivamente as versões recomendadas atuais (evidência: geradas pela ferramenta oficial na hora,
não uma suposição). Onda 3 do plano original **fica sem trabalho adicional**; ver progress doc.

### D4 — `npx cap sync android` NÃO exige JDK/Android SDK (correção de uma suposição da auditoria)

A Fase 1 apontou a ausência de Java/Android SDK/Gradle nesta máquina como bloqueio para "Onda 2". Testado
na prática: `npx cap add android` + `npx cap sync android` rodaram **sem erro e sem nenhuma dependência de
JDK** — são só cópia de arquivos (web assets → `android/app/src/main/assets/public`) e geração de config
Gradle (`capacitor.settings.gradle`/`capacitor.build.gradle`), nunca uma invocação real do
`./gradlew`/compilador Java. **A ausência de toolchain só bloqueia a COMPILAÇÃO de verdade** (`./gradlew
assembleDebug`, abrir no Android Studio, ou `npx cap run android`) — ou seja, a Onda 6 (gerar o APK), não
a integração em si. Mantém-se a recomendação de usar CI (Onda 6) para a compilação real.

## Pendências (Ondas 4–8)

Ver [`docs/ref/REF-CAP-01-progress.md`](../ref/REF-CAP-01-progress.md) para o estado onda a onda.
