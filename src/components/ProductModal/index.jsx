/* components/ProductModal/index.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx).
   Barrel do modal de produto: envolve ProductModalInner no ProductModalBoundary (proteção de erro). */
import { ProductModalInner } from './ProductModalInner.jsx';
import { ProductModalBoundary } from './ProductModalBoundary.jsx';

export function ProductModal(props){
  return (
    <ProductModalBoundary onClose={props.onClose}>
      <ProductModalInner {...props}/>
    </ProductModalBoundary>
  );
}
