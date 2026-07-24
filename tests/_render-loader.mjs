/* tests/_render-loader.mjs — REF-APP-01 · R9 (suporte à rede test:render).
   Loader ESM (node:module register) que permite importar os módulos .jsx/.js do src/ em Node puro:
   - .jsx/.js (dentro de src/, fora de node_modules) → compilado por esbuild (jsx automático, mesmo
     runtime do Vite). `define` substitui `import.meta.env` por um objeto vazio — mesma ideia do que o
     Vite faz de verdade (substitui por um literal), só que aqui SEMPRE vazio (este harness não carrega
     nenhum .env; nenhuma folha testada aqui deveria depender de valor real de env). Sem isto, qualquer
     módulo que leia `import.meta.env.X` (padrão usado em lib/supabase.js e lib/sentry.js, ambos fora do
     escopo deste teste mas alcançáveis transitivamente por um import novo) quebra com
     "Cannot read properties of undefined" — Node não tem `import.meta.env`, só o Vite injeta isso.
   - .css  → neutralizado (módulo vazio): no teste, o import de CSS é só side-effect visual.
   - node_modules → segue o carregamento padrão do Node (react/react-dom carregam normalmente).
   NÃO altera nenhum arquivo do projeto; é infra de teste, fora do grafo de build do Vite. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ENV_SHIM = { 'import.meta.env': '{}' }; // qualquer import.meta.env.X vira undefined, sem lançar

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  if ((url.endsWith('.jsx') || url.endsWith('.js')) && !url.includes('/node_modules/')) {
    const file = fileURLToPath(url);
    const src = await readFile(file, 'utf8');
    const { code } = await transform(src, {
      loader: url.endsWith('.jsx') ? 'jsx' : 'js',
      jsx: 'automatic',
      format: 'esm',
      sourcefile: file,
      define: ENV_SHIM,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
