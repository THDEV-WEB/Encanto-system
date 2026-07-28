# REF-MOBILE-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui — não
repetir trabalho já concluído abaixo.

**Contexto:** auditoria completa apresentada e aprovada pelo dono (aprovação formal registrada na
conversa — execução autônoma e contínua até o fim, ondas 1→7, commits ao final de cada onda, push+deploy
só no encerramento). Ícone oficial (`icone_encanto.png`, símbolo isolado panela+açaí, 1080×1080)
fornecido pelo dono durante a auditoria, salvo em `public/icon-encanto.png` antes da aprovação formal.

## Estado atual

🚧 EM EXECUÇÃO — Ondas 1–4 concluídas e commitadas. Ondas 5–7 em andamento na mesma sessão.

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

Status: ⏳ EM ANDAMENTO.

## Onda 7 — Testes finais

Status: ⏳ PENDENTE.

## Arquivos modificados até aqui

- `index.html` — manifest link, favicons/apple-touch-icon, viewport-fit, theme-color, Apple meta tags,
  meta description, Open Graph/Twitter Card.
- `public/manifest.json` (novo)
- `public/icon-encanto.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.ico`,
  `favicon-32.png`, `favicon-16.png` (novos)
- `docs/adr/REF-MOBILE-01-fundacao-mobile.md` (novo)
- `docs/ref/REF-MOBILE-01-progress.md` (novo, este arquivo)
- Nenhum arquivo de `src/` alterado até aqui — zero superfície de regressão em runtime nas Ondas 1–4.

## Pendências para o encerramento

- Onda 5: validação mobile (checklist manual + automatizado onde possível).
- Onda 6: Service Worker (cache seguro + estratégia de atualização, sem tocar Supabase/OAuth/Auth).
- Onda 7: suíte de testes final completa (domínio + E2E) + checklist de regressão.
- Atualizar `docs/adr/README.md` (índice oficial de ADRs) com a entrada da REF-MOBILE-01.
- Push + deploy (Vercel) + validação em produção + encerramento formal.
