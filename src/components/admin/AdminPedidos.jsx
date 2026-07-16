import { useOrders } from '../../hooks/useOrders.js';
import { DS } from '../../services/DataService.js';
import { fmt, fmtDataHoraLoja } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';

export function AdminPedidos() {
  const { orders, loading, refresh } = useOrders();
  const SM = {
    recebido: {label:'Recebido',cls:'status-recebido'},
    preparo:  {label:'Em Preparo',cls:'status-preparo'},
    entrega:  {label:'Saiu p/ Entrega',cls:'status-entrega'},
    entregue: {label:'Entregue',cls:'status-entregue'},
    cancelado:{label:'Cancelado',cls:'status-cancelado'},
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
              <thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Status</th><th>Horário</th><th>Alterar</th></tr></thead>
              <tbody>{orders.map((o,i)=>(
                <tr key={o.id}>
                  <td style={{fontWeight:700,color:'var(--amarelo)'}}>#{orders.length-i}</td>
                  <td>
                    <div style={{fontWeight:700}}>{o.customers?.name || '—'}</div>
                    <div style={{fontSize:12,color:'var(--gray-500)'}}>{o.customers?.phone || ''}</div>
                    <div style={{fontSize:12,color:'var(--gray-500)'}}>{(o.address||'').slice(0,35)}</div>
                  </td>
                  <td style={{fontWeight:700}}>{fmt(o.total)}</td>
                  <td><span className={`badge ${SM[o.status]?.cls||'badge-gray'}`}>{SM[o.status]?.label||o.status}</span></td>
                  <td style={{fontSize:12,color:'var(--gray-500)'}}>{fmtDataHoraLoja(o.created_at)}</td>
                  <td>
                    <select className="status-select" value={o.status||'recebido'}
                      onChange={async e=>{ await DS.setStatus(o.id,e.target.value); refresh(); }}>
                      {Object.entries(SM).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
