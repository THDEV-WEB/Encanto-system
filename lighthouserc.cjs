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
    /* REF-CI-02 (achado pos-push, log real obtido via API autenticada em 23/08): tanto COM
       `upload: { target: 'filesystem', outputDir: './.lighthouseci' }` (run 32640266072) quanto SEM
       essa secao (run 32642552214, tentativa de remove-la nao resolveu -- revertido aqui) o padrao e'
       IDENTICO: "Healthcheck passed" -> 3 rodadas completam ("Run #1/2/3...done", "Done running
       Lighthouse!") -> assert roda ("Checking assertions... All results processed!") -> "Done running
       autorun." -> MESMO ASSIM ".lighthouseci/" fica vazio. O processo inteiro reporta sucesso, entao
       nao e' crash -- e' a fase de persistencia que nao grava nada em disco por um motivo ainda nao
       identificado (nao e' a ausencia/presenca da secao upload, jah que os dois cenarios deram o
       mesmo resultado). Achado notavel em AMBOS os logs: "WARNING: Timed out waiting for the server
       to start listening" logo apos "Started a web server" -- o proprio servidor de preview imprime
       "Local:" (confirmado no log), mas o lhci nao detecta a tempo (os ~20s batem exatamente com
       startServerReadyTimeout). Nao confirmado se isso e' causa ou so' sintoma correlato. Restaurada a
       secao `upload` (documentacao oficial recomenda-a explicita pra filesystem, e remove-la nao teve
       efeito nenhum) -- ver `docs/adr/REF-CI-02-lighthouse.md` para o proximo passo (step de debug
       adicionado no ci.yml antes de tentar mais uma correcao especulativa). */
    upload: {
      target: 'filesystem',
      outputDir: './.lighthouseci',
    },
  },
};
