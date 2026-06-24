/**
 * BackgroundLayer
 * Camada de fundo global — ÚNICA fonte do background visual do sistema (loja + admin).
 * Renderizada uma única vez no topo da App, fixa atrás de todo o conteúdo.
 * O visual (gradiente premium) vive em `.bg-layer` no index.css, usando apenas
 * tokens existentes da paleta (--creme, --gray-100, --gray-200 + branco translúcido).
 */
export default function BackgroundLayer() {
  return <div className="bg-layer" aria-hidden="true" />;
}
