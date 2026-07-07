/* components/ui/Spinner.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx).
   Folha visual pura: estado de carregamento. Sem props, sem estado, sem domínio. */
export const Spinner = () => (
  <div className="loading-state">
    <div className="spinner"/>
    <span>Carregando...</span>
  </div>
);
