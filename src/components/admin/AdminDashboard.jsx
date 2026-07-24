import { useEffect } from 'react';
import { useOrders } from '../../hooks/useOrders.js';
import { fmt, fmtDataHoraLoja, dataLojaYMD } from '../../utils/format.js';

export function AdminDashboard() {
  const { orders, refresh } = useOrders();
  const hojeLoja = dataLojaYMD(new Date());   // "hoje" no fuso da LOJA (America/Sao_Paulo)
  const hoje  = orders.filter(o=>dataLojaYMD(o.created_at)===hojeLoja);
  const fatHoje  = hoje.reduce((a,o)=>a+Number(o.total||0),0);
  const emPreparo = orders.filter(o=>o.status==='preparo'||o.status==='recebido').length;
  const ticketMed = hoje.length>0 ? fatHoje/hoje.length : 0;
  const statusMap = {
    recebido:{label:'Recebido',cls:'status-recebido'},
    preparo: {label:'Em Preparo',cls:'status-preparo'},
    entrega: {label:'Saiu p/ Entrega',cls:'status-entrega'},
    entregue:{label:'Entregue',cls:'status-entregue'},
    cancelado:{label:'Cancelado',cls:'status-cancelado'},
  };

  /* Auto-refresh a cada 60s */
  useEffect(()=>{
    const t=setInterval(()=>refresh(),60000);
    return()=>clearInterval(t);
  },[refresh]);

  return (
    <div>
      {/* Métricas principais */}
      <div className="stat-cards" style={{gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
        <div className="stat-card" style={{borderTop:'3px solid var(--grape)'}}>
          <div className="stat-icon">🌅</div>
          <div className="stat-val">{hoje.length}</div>
          <div className="stat-label">Pedidos hoje</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid #16A34A'}}>
          <div className="stat-icon">💰</div>
          <div className="stat-val">{fmt(fatHoje)}</div>
          <div className="stat-label">Faturamento hoje</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid var(--orange)'}}>
          <div className="stat-icon">👨‍🍳</div>
          <div className="stat-val">{emPreparo}</div>
          <div className="stat-label">Em preparo</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid #0891B2'}}>
          <div className="stat-icon">📊</div>
          <div className="stat-val">{fmt(ticketMed)}</div>
          <div className="stat-label">Ticket médio</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid var(--gray-300)'}}>
          <div className="stat-icon">📦</div>
          <div className="stat-val">{orders.length}</div>
          <div className="stat-label">Total geral</div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="stat-cards" style={{marginBottom:20}}>
        {Object.entries(statusMap).map(([k,v])=>(
          <div key={k} className="stat-card" style={{padding:'12px 16px'}}>
            <div className="stat-val" style={{fontSize:20}}>{orders.filter(o=>o.status===k).length}</div>
            <div className="stat-label">{v.label}</div>
          </div>
        ))}
      </div>

      {/* Últimos pedidos */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>📋 Últimos pedidos</h3>
          <button className="btn-secondary" onClick={refresh}>🔄 Atualizar</button>
        </div>
        {orders.length===0
          ?<div className="empty-state"><div className="icon">📋</div><p>Nenhum pedido</p></div>
          :<table className="data-table">
             <thead><tr><th>Cliente</th><th>Total</th><th>Status</th><th>Horário</th></tr></thead>
             <tbody>{orders.slice(0,10).map(o=>(
               <tr key={o.id}>
                 <td>
                   {/* FIX (achado REF-ADMIN-01 · Onda 3, ex-REF-E2E-03 §1.3): o.cliente_nome/telefone
                       nunca existiram no retorno de DS.getPedidos() (o select traz `customers:{name,phone}`
                       aninhado) — a coluna sempre renderizou em branco. Mesmo acesso já usado em
                       AdminPedidos.jsx (aba Pedidos), com fallback p/ pedidos sem cliente vinculado. */}
                   <div style={{fontWeight:600}}>{o.customers?.name || '—'}</div>
                   <div style={{fontSize:11,color:'var(--gray-500)'}}>{o.customers?.phone || ''}</div>
                 </td>
                 <td style={{fontWeight:700}}>{fmt(o.total)}</td>
                 <td><span className={`badge ${statusMap[o.status]?.cls||'badge-gray'}`}>
                   {statusMap[o.status]?.label||o.status}
                 </span></td>
                 <td style={{fontSize:12,color:'var(--gray-500)'}}>{fmtDataHoraLoja(o.created_at)}</td>
               </tr>
             ))}</tbody>
           </table>
        }
      </div>
    </div>
  );
}
