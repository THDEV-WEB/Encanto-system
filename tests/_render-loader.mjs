/* tests/_render-loader.mjs — REF-APP-01 · R9 (suporte à rede test:render).
   Loader ESM (node:module register) que permite importar os módulos .jsx do src/ em Node puro:
   - .jsx  → compilado por esbuild (jsx automático, mesmo runtime do Vite) → módulo ESM.
   - .css  → neutralizado (módulo vazio): no teste, o import de CSS é só side-effect visual.
   - resto → segue o carregamento padrão do Node (react/react-dom vêm do node_modules normalmente).
   NÃO altera nenhum arquivo do projeto; é infra de teste, fora do grafo de build do Vite. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  if (url.endsWith('.jsx')) {
    const file = fileURLToPath(url);
    const src = await readFile(file, 'utf8');
    const { code } = await transform(src, {
      loader: 'jsx',
      jsx: 'automatic',
      format: 'esm',
      sourcefile: file,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
