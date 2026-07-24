/* components/admin/AdminDashboard.jsx — REF-ADMIN-03 · Onda 3: agregados via useOrdersStats (SQL,
   RPC admin_orders_stats) em vez de reduzir um array de no máximo 100 pedidos (useOrders antigo).
   Causa raiz do que isto substitui: "Total geral"/breakdown por status vinham de orders.length /
   orders.filter(...).length sobre um array com limit(100) fixo — correto só enquanto o histórico
   total coubesse nessas 100 linhas; a partir daí ficava silenciosamente errado (capado). Os agregados
   agora são calculados no banco, sobre a tabela inteira, sem esse teto. */
import { useOrdersStats } from '../../hooks/useOrdersStats.js';
import { fmt, fmtDataHoraLoja } from '../../utils/format.js';

export function AdminDashboard() {
  const { stats, recentes, refresh } = useOrdersStats(10);
  const breakdown  = stats?.breakdown || {};
  const hojeCount  = stats?.hoje_count || 0;
  const hojeTotal  = Number(stats?.hoje_total || 0);
  const totalGeral = stats?.total_geral || 0;
  const emPreparo  = (breakdown.recebido || 0) + (breakdown.preparo || 0);
  const ticketMed  = hojeCount > 0 ? hojeTotal / hojeCount : 0;
  const statusMap = {
    recebido:{label:'Recebido',cls:'status-recebido'},
    preparo: {label:'Em Preparo',cls:'status-preparo'},
    entrega: {label:'Saiu p/ Entrega',cls:'status-entrega'},
    entregue:{label:'Entregue',cls:'status-entregue'},
    cancelado:{label:'Cancelado',cls:'status-cancelado'},
  };

  return (
    <div>
      {/* Métricas principais */}
      <div className="stat-cards" style={{gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
        <div className="stat-card" style={{borderTop:'3px solid var(--grape)'}}>
          <div className="stat-icon">🌅</div>
          <div className="stat-val">{hojeCount}</div>
          <div className="stat-label">Pedidos hoje</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid #16A34A'}}>
          <div className="stat-icon">💰</div>
          <div className="stat-val">{fmt(hojeTotal)}</div>
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
          <div className="stat-val">{totalGeral}</div>
          <div className="stat-label">Total geral</div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="stat-cards" style={{marginBottom:20}}>
        {Object.entries(statusMap).map(([k,v])=>(
          <div key={k} className="stat-card" style={{padding:'12px 16px'}}>
            <div className="stat-val" style={{fontSize:20}}>{breakdown[k] || 0}</div>
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
        {recentes.length===0
          ?<div className="empty-state"><div className="icon">📋</div><p>Nenhum pedido</p></div>
          :<table className="data-table">
             <thead><tr><th>Cliente</th><th>Total</th><th>Status</th><th>Horário</th></tr></thead>
             <tbody>{recentes.map(o=>(
               <tr key={o.id}>
                 <td>
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
