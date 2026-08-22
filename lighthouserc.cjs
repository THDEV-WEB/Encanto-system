/* REF-CI-02: mede performance/acessibilidade/best-practices/SEO do build de producao a cada push/PR.
   Roda contra o build normal (npm run build, mesma saida servida pela Vercel), preview local via
   startServerCommand -- o proprio @lhci/cli sobe e derruba o servidor, nao precisa orquestrar isso no
   workflow. `.env` e' escrito ANTES do build (passo do ci.yml) com as credenciais do projeto Supabase
   DEDICADO a testes (REF-E2E-01, mesmos secrets do job `e2e`) -- nunca producao, e nunca em estado
   degradado (db=null): sem os secrets configurados no repo, cai no mesmo fallback ja usado pelo job
   `e2e` (URL/key ficticios) e mede a home vazia -- nao falha, so mede menos coisa.

   REF-PERF-02 (thresholds bloqueantes, decidido aqui): `numberOfRuns` subiu de 1 pra 3 -- medicao
   local (5 runs seguidos, mesmo build/mesmo projeto E2E) mostrou score variando de **71 a 94** de uma
   rodada pra outra, sozinho (mediana 92). Causa: fetch REAL contra o projeto Supabase E2E na internet
   (nao mockado) -- o tempo de resposta varia por rodada e desloca quando o catalogo troca o skeleton
   pela grade real, o que move a metrica de CLS mais que qualquer outra (0.108 numa rodada boa, 0.556
   numa rodada com fetch lento). `numberOfRuns:3` faz o proprio LHCI agregar pela MEDIANA -- reduz
   bastante a chance de um outlier de rede reprovar o CI sozinho. `minScore` de performance ficou em
   0.80: confortavelmente abaixo da mediana medida (0.92) mas acima do pior caso isolado observado
   (0.71), pra pegar regressao real sem virar CI instavel por variacao de rede que nao e' bug de
   codigo. Sem assert em accessibility/best-practices/seo ainda -- fora do escopo desta REF (so
   performance foi auditada/otimizada aqui). */
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run preview -- --port 4173 --strictPort',
      startServerReadyPattern: 'Local:',
      startServerReadyTimeout: 20000,
      url: ['http://localhost:4173/encanto/'],
      numberOfRuns: 3,
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
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.8 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './.lighthouseci',
    },
  },
};
