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

🚧 Onda 1 (Dual Build) CONCLUÍDA. Ondas 2–8 pendentes.

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

Status: ⏳ PENDENTE. Instalar `@capacitor/core`/`@capacitor/cli`/`@capacitor/android`, `npx cap init`,
`capacitor.config` apontando `webDir` para `dist/capacitor` (saída da Onda 1), `npx cap add android`,
`npx cap sync`.

## Onda 3 — Projeto Android

Status: ⏳ PENDENTE. `compileSdkVersion`/`targetSdkVersion`/Gradle/AndroidX nas versões atuais
recomendadas (resolve o alerta do Play Protect na raiz).

## Onda 4 — Integração nativa

Status: ⏳ PENDENTE. Antes de implementar: documentar tecnicamente a decisão do fluxo Google OAuth
(Browser + Deep Link + PKCE) e seus impactos arquiteturais — instrução explícita do dono, cumprir antes de
qualquer código deste fluxo. Depois: Redirect Supabase (nova entrada no allow-list), botão físico
"voltar", permissões (geolocalização), impressão (comanda térmica do admin).

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
- `package.json` — scripts `build:capacitor`/`preview:capacitor` (Onda 1).
- `docs/adr/REF-CAP-01-app-nativo-android.md` (novo)
- `docs/ref/REF-CAP-01-progress.md` (novo, este arquivo)
