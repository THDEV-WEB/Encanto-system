import { useState, Fragment } from 'react';
import { useOrders } from '../../hooks/useOrders.js';
import { DS } from '../../services/DataService.js';
import { fmt, fmtDataHoraLoja } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';
import { ComandaModal } from './comanda/ComandaModal.jsx';
import { PedidoHistorico } from './PedidoHistorico.jsx';

export function AdminPedidos() {
  const { orders, loading, refresh } = useOrders();
  /* REF-ORDER-01: inserido 'pronto' (Recebido -> Em Preparo -> Pronto -> Saiu p/ Entrega -> Entregue).
     'pronto' nao tem classe de badge no index.css (sob outra frente); recebe cor via `style` inline —
     os demais seguem usando as classes ja existentes. */
  const SM = {
    recebido: {label:'Recebido',cls:'status-recebido'},
    preparo:  {label:'Em Preparo',cls:'status-preparo'},
    pronto:   {label:'Pronto',cls:'badge-gray',style:{background:'#CCFBF1',color:'#0F766E'}},
    entrega:  {label:'Saiu p/ Entrega',cls:'status-entrega'},
    entregue: {label:'Entregue',cls:'status-entregue'},
    cancelado:{label:'Cancelado',cls:'status-cancelado'},
  };
  const [comanda, setComanda] = useState(null);   // { order, numero, count }
  const [histId,  setHistId]  = useState(null);   // id do pedido com historico aberto

  const abrirComanda = async (order, numero) => {
    setComanda({ order, numero, count: null });
    const count = await DS.countPedidosByCustomer(order.customer_id);
    setComanda((c) => (c && c.order?.id === order.id ? { ...c, count } : c));
  };

  return (
    <div>
      <div className="stat-cards">
        {Object.entries(SM).map(([k,v])=>(
          <div key={k} className="stat-card">
            <div className="stat-val">{orders.filter(o=>o.status===k).length}</div>
            <div className="stat-label">{v.label}</div>
          </div>
        ))}
      </div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Pedidos ({orders.length})</h3>
          <button className="btn-secondary" onClick={refresh}>🔄 Atualizar</button>
        </div>
        {loading?<Spinner/>:orders.length===0?(
          <div className="empty-state"><div className="icon">📋</div><p>Nenhum pedido ainda</p></div>
        ):(
          <div style={{overflowX:'auto'}}>
            <table className="data-table">
              <thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Status</th><th>Horário</th><th>Alterar</th><th>Ações</th></tr></thead>
              <tbody>{orders.map((o,i)=>{
                const numero = orders.length-i;
                const aberto = histId===o.id;
                return (
                <Fragment key={o.id}>
                <tr>
                  <td style={{fontWeight:700,color:'var(--amarelo)'}}>#{numero}</td>
                  <td>
                    <div style={{fontWeight:700}}>{o.customers?.name || '—'}</div>
                    <div style={{fontSize:12,color:'var(--gray-500)'}}>{o.customers?.phone || ''}</div>
                    <div style={{fontSize:12,color:'var(--gray-500)'}}>{(o.address||'').slice(0,35)}</div>
                  </td>
                  <td style={{fontWeight:700}}>{fmt(o.total)}</td>
                  <td><span className={`badge ${SM[o.status]?.cls||'badge-gray'}`} style={SM[o.status]?.style}>{SM[o.status]?.label||o.status}</span></td>
                  <td style={{fontSize:12,color:'var(--gray-500)'}}>{fmtDataHoraLoja(o.created_at)}</td>
                  <td>
                    <select className="status-select" value={o.status||'recebido'}
                      onChange={async e=>{ await DS.setStatus(o.id,e.target.value); refresh(); }}>
                      {Object.entries(SM).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn-secondary" title="Imprimir comanda" aria-label="Imprimir comanda"
                        style={{padding:'6px 10px'}} onClick={()=>abrirComanda(o,numero)}>🧾</button>
                      <button className="btn-secondary" title="Histórico de status" aria-label="Histórico de status"
                        aria-expanded={aberto} style={{padding:'6px 10px'}}
                        onClick={()=>setHistId(aberto?null:o.id)}>🕑</button>
                    </div>
                  </td>
                </tr>
                {aberto && (
                  <tr>
                    <td colSpan={7} style={{background:'var(--gray-50,#faf7f2)'}}>
                      <PedidoHistorico orderId={o.id}/>
                    </td>
                  </tr>
                )}
                </Fragment>
              );})}</tbody>
            </table>
          </div>
        )}
      </div>
      {comanda && (
        <ComandaModal
          order={comanda.order}
          numero={comanda.numero}
          totalPedidos={comanda.count}
          onClose={()=>setComanda(null)}
        />
      )}
    </div>
  );
}
