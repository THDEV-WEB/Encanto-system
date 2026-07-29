# REF-MOBILE-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui — não
repetir trabalho já concluído abaixo.

**Contexto:** auditoria completa apresentada e aprovada pelo dono (aprovação formal registrada na
conversa — execução autônoma e contínua até o fim, ondas 1→7, commits ao final de cada onda, push+deploy
só no encerramento). Ícone oficial (`icone_encanto.png`, símbolo isolado panela+açaí, 1080×1080)
fornecido pelo dono durante a auditoria, salvo em `public/icon-encanto.png` antes da aprovação formal.

## Estado atual

✅ REF-MOBILE-01 ENCERRADA TECNICAMENTE. Ondas 1–7 concluídas, testadas, documentadas e commitadas
(8 commits). Push feito (`origin/main` `8781429..e51866a`). CI real no GitHub Actions verde (run
30406833808: Build/Domínio/E2E). Deploy Vercel confirmado ao vivo (manifest/sw.js/ícones em produção
com o conteúdo exato desta REF). Única pendência: checklist de validação manual em dispositivo real
(Android Chrome, Samsung Internet, Safari iOS, login Google real), de responsabilidade do dono — ver
seção "Encerramento" do ADR.

## Onda 1 — Web App Manifest

Status: ✅ CONCLUÍDA. Commit `8c8a7ce`. `public/manifest.json` + `<link rel="manifest">` em
`index.html`. `npm run build` limpo, `test:domain` 29/29.

## Onda 2 — Conjunto de ícones

Status: ✅ CONCLUÍDA. Commit `7e1e6fd`. `icon-192.png`/`icon-512.png`/`apple-touch-icon.png`/
`favicon.ico`/`favicon-32.png`/`favicon-16.png` gerados a partir de `public/icon-encanto.png`. Links
correspondentes em `index.html`. Build + `test:domain` verdes.

## Onda 3 — Head mobile/SEO

Status: ✅ CONCLUÍDA. Commit `d1fb48b`. `viewport-fit=cover` + remoção de `maximum-scale`; theme-color;
Apple meta tags; meta description; Open Graph/Twitter Card. `robots.txt` deliberadamente não criado
(motivo documentado no ADR, D6). Build + `test:domain` verdes.

## Onda 4 — ADR Mobile

Status: ✅ CONCLUÍDA (este commit). `docs/adr/REF-MOBILE-01-fundacao-mobile.md` (decisões D1–D9,
incluindo a estratégia "Capacitor-Ready" sem implementar Capacitor) + este progress doc.

## Onda 5 — Validação mobile

Status: ✅ CONCLUÍDA (camada automatizada). 20/20 checks via Playwright/Chromium contra `vite preview`
real (manifest, ícones, boot sem erros de console, viewport sem `maximum-scale`/com `viewport-fit`,
2 viewports mobile sem overflow, screenshots conferidos visualmente). Camada manual em dispositivo real
(Android Chrome/Samsung Internet/Safari iOS) **adiada para o Encerramento**, quando existe uma URL
pública HTTPS de verdade para o dono instalar — ver checklist na seção de Encerramento. Nenhum código de
`src/`/`public/` alterado nesta onda (só verificação + documentação).

## Onda 6 — Service Worker

Status: ✅ CONCLUÍDA. `vite-plugin-pwa` instalado (dev-only; `npm audit --omit=dev` = 0 vulnerabilidades
em produção). `vite.config.js` (D8: `manifest:false`, `registerType:'prompt'`, sem `runtimeCaching`,
`devOptions.enabled:false`). `src/hooks/usePwaUpdate.js` (novo) + `App.jsx` (Toast de "nova versão
disponível", persistente até o clique). `sw.js` gerado inspecionado por completo: só precache same-origin
+ 1 NavigationRoute, zero referência a Supabase/Google. Validação crítica (Playwright dedicado, não
commitado): navegação de retorno do OAuth (`?code=...`) confirmada como servida PELO PRÓPRIO SW
(`response.fromServiceWorker()`) e ainda assim preserva a query string/renderiza normalmente — prova
empírica de que o cenário mais delicado desta onda é seguro. `test:domain` 29/29 + `test:e2e` **113/113**
(incluindo o spec que testa o disparo do login Google) — zero regressão.

## Onda 7 — Testes finais

Status: ✅ CONCLUÍDA. Build limpo do zero (`rm -rf dist && npm run build`). `test:domain` 29/29 (309
asserções). `test:e2e` completo (Chromium) reexecutado do zero: **113/113**, 2ª execução confirmando
reprodutibilidade após a Onda 6. Lighthouse real tentado (via `chrome-launcher` apontado pro Chromium do
Playwright) — falhou por um `EPERM` de permissão do Windows ao limpar seu próprio diretório temporário
(falha da ferramenta/ambiente, não do app); não bloqueia o encerramento, a prontidão já está coberta
pelas validações próprias das Ondas 5–6. Zero regressão em qualquer camada de teste.

## Arquivos modificados até aqui

- `index.html` — manifest link, favicons/apple-touch-icon, viewport-fit, theme-color, Apple meta tags,
  meta description, Open Graph/Twitter Card.
- `public/manifest.json` (novo)
- `public/icon-encanto.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.ico`,
  `favicon-32.png`, `favicon-16.png` (novos)
- `docs/adr/REF-MOBILE-01-fundacao-mobile.md` (novo)
- `docs/ref/REF-MOBILE-01-progress.md` (novo, este arquivo)
- `package.json`/`package-lock.json` — `vite-plugin-pwa` (devDependency)
- `vite.config.js` — plugin `pwaPlugin` (Onda 6)
- `src/hooks/usePwaUpdate.js` (novo, Onda 6)
- `src/App.jsx` — hook `usePwaUpdate` + Toast de atualização (Onda 6)
- Ondas 1–5: nenhum arquivo de `src/` alterado. Onda 6: `App.jsx` + 1 hook novo, ambos cobertos por
  `test:domain` (29/29) e `test:e2e` (113/113) após a mudança.

## Pendências para o encerramento

- Onda 7: suíte de testes final completa (domínio + E2E) + checklist de regressão.
- Atualizar `docs/adr/README.md` (índice oficial de ADRs) com a entrada da REF-MOBILE-01.
- Checklist de validação manual em dispositivo real (Android Chrome, Samsung Internet, Safari iOS) +
  confirmação de login Google real — a entregar ao dono, pós-deploy.
- Push + deploy (Vercel) + validação em produção + encerramento formal.

## Ajuste pós-encerramento — refinamento visual do ícone

Status: ✅ CONCLUÍDO. Dono avaliou o ícone da Onda 2 como "funcional mas não profissional" (símbolo
ocupava só ~49%×64% do canvas). Recorte novo, nativo/sem upscale (680×680 do 1080×1080 original), medido
por varredura de pixels antes e depois — preenchimento sobe pra ~68%×80%+, cortando só as pontas da folha
decorativa (a folha, não o pote/açaí). Validado ANTES de exportar via mockup HTML (artifact — aba do
navegador, Android/iOS home screen, 3 máscaras de Adaptive Icon com zona de segurança, PWA instalado
desktop, favicon 16px real), aprovado pelo dono, só então os 6 arquivos derivados foram regenerados.
`public/icon-encanto.png` agora É o novo recorte (arquivo bruto original recuperável via git history,
commit `7e1e6fd`). Build limpo + `test:domain` 29/29 (só `public/` mudou).
