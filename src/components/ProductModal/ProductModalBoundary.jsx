/* components/ProductModal/ProductModalBoundary.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx).
   Error boundary do modal de produto. Apresentacional, sem domínio. Sem erro → renderiza os children. */
import React from 'react';

export class ProductModalBoundary extends React.Component {
  constructor(p){super(p);this.state={err:null};}
  static getDerivedStateFromError(e){return {err:e};}
  render(){
    if(this.state.err) return (
      <div className="modal-overlay" onClick={this.props.onClose}>
        <div className="modal" style={{padding:32,textAlign:'center',maxWidth:360}}>
          <div style={{fontSize:48,marginBottom:12}}>😕</div>
          <h3 style={{fontFamily:'var(--font-head)',marginBottom:8}}>Erro ao carregar produto</h3>
          <p style={{fontSize:13,color:'var(--gray-500)',marginBottom:20}}>
            Tente novamente ou escolha outro item.
          </p>
          <button className="btn-primary" onClick={()=>{this.setState({err:null});this.props.onClose();}}>
            Fechar
          </button>
        </div>
      </div>
    );
    return this.props.children;
  }
}
