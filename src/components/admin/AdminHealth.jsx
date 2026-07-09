import { useState, useEffect, useCallback } from 'react';
import { DS } from '../../services/DataService.js';
import { fmt, fmtDate } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';

/* HARDEN-06: painel de Saúde/Observabilidade — consome orders_health() (só agregados, sem PII). */
export function AdminHealth() {
  const [h, setH]             = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async()=>{ setLoading(true); setH(await DS.getHealth()); setLoading(false); },[]);
  useEffect(()=>{ load(); },[load]);
  const Card = ({icon,val,label,color}) => (
    <div className="stat-card" style={{borderTop:`3px solid ${color}`}}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-val">{val}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
  return (
    <div>
      <div className="admin-card-header" style={{marginBottom:12}}>
        <h3>🩺 Saúde do Sistema</h3>
        <button className="btn-secondary" onClick={load}>🔄 Atualizar</button>
      </div>
      {loading ? <Spinner/> : !h ? (
        <div className="empty-state"><div className="icon">🩺</div><p>Sem dados de saúde</p></div>
      ) : (
        <>
          <div className="stat-cards" style={{gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))'}}>
            <Card icon="🌅" val={h.pedidos_hoje}           label="Pedidos hoje"     color="var(--grape)"/>
            <Card icon="💰" val={fmt(h.faturamento_hoje)}  label="Faturamento hoje" color="#16A34A"/>
            <Card icon="📊" val={fmt(h.ticket_medio_hoje)} label="Ticket médio"     color="#0891B2"/>
            <Card icon="📦" val={h.pedidos_total}          label="Total geral"      color="var(--gray-300)"/>
            <Card icon="⚠️" val={h.erros_24h}              label="Erros 24h"        color="var(--orange)"/>
            <Card icon="🧮" val={h.divergencias}           label="Divergências"     color={h.divergencias>0?'#DC2626':'#16A34A'}/>
          </div>
          {Array.isArray(h.serie_7d) && h.serie_7d.length>0 && (
            <div style={{marginTop:20}}>
              <div className="stat-label" style={{marginBottom:8}}>
                Pedidos/dia (7 dias) · Taxa de erro 24h: <b>{h.taxa_erro_pct}%</b>
              </div>
              <div style={{display:'flex',alignItems:'flex-end',gap:6,height:90}}>
                {(()=>{ const max=Math.max(1,...h.serie_7d.map(x=>Number(x.n)||0));
                  return h.serie_7d.map((d,i)=>(
                    <div key={i} style={{flex:1,textAlign:'center'}}>
                      <div style={{height:`${((Number(d.n)||0)/max)*60}px`,minHeight:2,background:'var(--grape)',borderRadius:4,marginBottom:4}} title={String(d.n)}/>
                      <div style={{fontSize:11,fontWeight:700}}>{Number(d.n)||0}</div>
                      <div style={{fontSize:10,color:'var(--gray-500)'}}>{d.dia}</div>
                    </div>
                  )); })()}
              </div>
            </div>
          )}
          <div style={{marginTop:16,fontSize:12,color:'var(--gray-500)'}}>
            Pedidos 7d: {h.pedidos_7d} · 24h: {h.pedidos_24h} · Logs: {h.logs_total} · Atualizado: {fmtDate(h.gerado_em)}
          </div>
        </>
      )}
    </div>
  );
}
