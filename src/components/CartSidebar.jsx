/* components/CartSidebar.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx).
   Drawer do carrinho. Apresentacional (recebe cart/catMap por props).
   Consumidor de dominio (utils/pricing: precoUnitario) -> allowlist D1 do test:deps. */
import { precoUnitario } from '../utils/pricing.js';
import { fmt } from '../utils/format.js';
import { catEmoji, isHttpUrl } from '../utils/catalog.js';
export function CartSidebar({ cart, catMap, onClose, onCheckout }) {
  const { items, total, remove, updateQty } = cart;
  return (
    <>
      <div className="cart-overlay" onClick={onClose}/>
      <div className="cart-sidebar">
        <div className="cart-header">
          <h2>🛒 Seu Pedido</h2>
          <button className="cart-close" data-testid="cart-close" onClick={onClose}>✕</button>
        </div>
        {items.length===0 ? (
          <div className="cart-empty">
            <div className="icon">🛒</div>
            <p>Seu carrinho está vazio.<br/>Adicione itens para continuar!</p>
          </div>
        ) : (
          <div className="cart-items">
            {items.map(item=>{
              const unit  = precoUnitario(item);
              const cNome = catMap[item.categoria_id]?.nome||'';
              return (
                <div key={item._key} className="cart-item" data-prod={item.id}>
                  <div className="cart-item-img">
                    {isHttpUrl(item.imagem_url)
                      ? <img loading="lazy" src={item.imagem_url} alt={item.nome}
                          style={{width:'100%',height:'100%',objectFit:'cover'}}
                          onError={e=>{ e.target.style.display='none'; }}/>
                      : catEmoji(cNome)}
                  </div>
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.nome}</div>
                    {item.adicionais?.length>0&&(
                      <div className="cart-item-additionals">{item.adicionais.map(a=>a.nome).join(', ')}</div>
                    )}
                    {item.obs&&<div className="cart-item-additionals" style={{fontStyle:'italic'}}>"{item.obs}"</div>}
                    <div className="cart-item-footer">
                      <span className="cart-item-price">{fmt(unit*item.qty)}</span>
                      <div className="cart-item-qty">
                        <button className="cqty-btn" onClick={()=>updateQty(item._key,-1)}>−</button>
                        <span className="cqty-val">{item.qty}</span>
                        <button className="cqty-btn" onClick={()=>updateQty(item._key,1)}>+</button>
                        <button className="cart-remove" onClick={()=>remove(item._key)}>🗑</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="cart-footer">
          <div className="cart-total-row"><span>Subtotal</span><span>{fmt(total)}</span></div>
          <div className="cart-total-row"><span>Entrega</span>
            <span style={{color:'var(--green)',fontWeight:600}}>A combinar</span>
          </div>
          <div className="cart-total-row grand"><span>Total</span><span>{fmt(total)}</span></div>
          <button className="checkout-btn" disabled={items.length===0}
            onClick={()=>{onClose();onCheckout();}}>
            Finalizar Pedido →
          </button>
        </div>
      </div>
    </>
  );
}
