/* REF-CI-02: mede performance/acessibilidade/best-practices/SEO do build de producao a cada push/PR.
   Roda contra o build normal (npm run build, mesma saida servida pela Vercel), preview local via
   startServerCommand -- o proprio @lhci/cli sobe e derruba o servidor, nao precisa orquestrar isso no
   workflow. `.env` e' escrito ANTES do build (passo do ci.yml) com as credenciais do projeto Supabase
   DEDICADO a testes (REF-E2E-01, mesmos secrets do job `e2e`) -- nunca producao, e nunca em estado
   degradado (db=null): sem os secrets configurados no repo, cai no mesmo fallback ja usado pelo job
   `e2e` (URL/key ficticios) e mede a home vazia -- nao falha, so mede menos coisa.

   Sem `assert`: 1o run desta REF so estabelece a infraestrutura de medicao/historico (relatorio
   sobe como artifact do proprio run). A baseline real (REF-PERF-01) e' 68/100 MOBILE, medida contra
   PRODUCAO com catalogo real de 38 produtos -- medir aqui contra o catalogo fixture (menor) do projeto
   E2E tende a dar numero diferente. Thresholds bloqueantes ficam pra REF-PERF-02 decidir, com uma
   baseline medida DENTRO do CI (nao a de produção). */
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run preview -- --port 4173 --strictPort',
      startServerReadyPattern: 'Local:',
      startServerReadyTimeout: 20000,
      url: ['http://localhost:4173/encanto/'],
      numberOfRuns: 1,
      settings: {
        // mesma metodologia da REF-PERF-01 (baseline 37->68/100): mobile + throttling simulado (nao
        // depende da velocidade de rede/CPU do runner do GitHub, reprodutivel run a run).
        formFactor: 'mobile',
        throttlingMethod: 'simulate',
        screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 2, disabled: false },
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        chromeFlags: '--no-sandbox',
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './.lighthouseci',
    },
  },
};
