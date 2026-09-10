// REF-PAGAMENTO-01 · Onda 7 (fix real) -- teste de regressao do CSP contra o Payment Brick.
//
// BUG REAL encontrado e corrigido: vercel.json liberava mlstatic.com só em img-src/connect-src --
// nunca em script-src. O Payment Brick carrega peças de JS (components/payment.js e outros chunks)
// de http2.mlstatic.com, então em produção (onde o CSP é de fato aplicado -- Vite dev NUNCA aplica
// CSP, por isso isso nunca foi pego nas Ondas 5/6) esse script era bloqueado silenciosamente:
// `mp.bricks().create()` RESOLVIA a Promise (nunca rejeitava) com um controller quebrado, container
// ficava vazio pra sempre -- tela branca sem erro nenhum visível pro cliente.
//
// Este teste fecha o gap "CSP não testável localmente" (documentado desde a Onda 5): sobe uma pagina
// minima que reproduz o MESMO mount do Brick que PagamentoOnlinePage.jsx faz (SDK real, mesma chave
// TEST usada nesta REF, mesmo customization.paymentMethods), servida com o CSP REAL lido direto de
// vercel.json (fonte única -- nunca duplica a string, não pode ficar dessincronizado), via Chromium
// real (Playwright, que APLICA CSP de verdade, ao contrário do Vite dev). Falha se o Brick não montar
// ou se aparecer qualquer violação de CSP envolvendo mercadopago.com/mlstatic.com/mercadolibre.com.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const require = createRequire('C:/Projetos/Encanto/encanto-react/package.json');
const { chromium } = require('@playwright/test');

const ROOT = 'C:/Projetos/Encanto/encanto-react';
const PORT = 8935;
const PUBLIC_KEY = 'TEST-25c32e88-3a54-42a0-8444-d8129f79029d'; // mesma chave real de teste ja usada nesta REF (Onda 5/6/7)

function lerCspDeVercelJson() {
  const vercelJson = JSON.parse(readFileSync(`${ROOT}/vercel.json`, 'utf8'));
  const bloco = vercelJson.headers.find((h) => h.source === '/(.*)');
  const csp = bloco.headers.find((h) => h.key === 'Content-Security-Policy');
  if (!csp) throw new Error('vercel.json sem Content-Security-Policy no bloco /(.*)  -- verifique o arquivo');
  return csp.value;
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="pagamento-online-brick-container"></div>
<script src="/repro.js"></script>
</body></html>`;

// Mesmo mount de PagamentoOnlinePage.jsx (Onda 5/6): SDK carregado via <script> dinamico, MESMO
// customization.paymentMethods (Pix + cartao, achados reais da Onda 5 preservados: 'none' invalido
// pra creditCard/debitCard/prepaidCard, [] pra ticket).
const REPRO_JS = `
window.__resultado = { ready: false, containerLen: 0, cspViolacoesMp: [] };
document.addEventListener('securitypolicyviolation', (e) => {
  if (/mercadopago\\.com|mlstatic\\.com|mercadolibre\\.com/i.test(e.blockedURI || '')) {
    window.__resultado.cspViolacoesMp.push(e.violatedDirective + ' :: ' + e.blockedURI);
  }
});
const js = document.createElement('script');
js.src = 'https://sdk.mercadopago.com/js/v2';
js.onload = () => {
  const mp = new window.MercadoPago('${PUBLIC_KEY}', { locale: 'pt-BR' });
  mp.bricks().create('payment', 'pagamento-online-brick-container', {
    initialization: { amount: 25.90 },
    customization: { paymentMethods: {
      bankTransfer: 'all', creditCard: 'all', debitCard: 'all', prepaidCard: 'all',
      ticket: [], mercadoPago: 'none',
    } },
    callbacks: {
      onReady: () => { window.__resultado.ready = true; },
      onSubmit: () => new Promise(() => {}),
      onError: () => {},
    },
  }).then(() => {
    window.__resultado.containerLen = document.getElementById('pagamento-online-brick-container').innerHTML.length;
  });
};
document.head.appendChild(js);
`;

function startServer(csp) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/repro.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Security-Policy': csp });
        res.end(REPRO_JS);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp });
        res.end(HTML);
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

let pass = 0, fail = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }

async function main() {
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 7 (fix real) — CSP x Payment Brick (Chromium real)');
  console.log('==========================================================================\n');

  const csp = lerCspDeVercelJson();
  check('vercel.json script-src inclui mlstatic.com (peças do Brick)', /script-src[^;]*mlstatic\.com/.test(csp), csp);

  const server = await startServer(csp);
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleErros = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErros.push(msg.text()); });

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => window.__resultado);

    check('Brick onReady disparou (montou de verdade, nao travou)', r.ready === true, JSON.stringify(r));
    check('container do Brick tem conteudo real (nao ficou vazio/branco)', r.containerLen > 0, `len=${r.containerLen}`);
    check('nenhuma violacao de CSP envolvendo mercadopago/mlstatic/mercadolibre', r.cspViolacoesMp.length === 0, JSON.stringify(r.cspViolacoesMp));

    await browser.close();
  } finally {
    server.close();
  }

  console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
  process.exitCode = fail > 0 ? 1 : 0;
}
main().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
