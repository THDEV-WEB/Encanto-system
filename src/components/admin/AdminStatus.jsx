import { useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storage.js';

/* ── Admin: Status do Estabelecimento ─────────────────────── */
export function AdminStatus() {
  const [status, setStatus] = useState(()=>{
    return localStorage.getItem(STORAGE_KEYS.STORE_STATUS) || 'open';
  });
  const toggle = (val) => {
    setStatus(val);
    localStorage.setItem(STORAGE_KEYS.STORE_STATUS, val);
  };
  return (
    <div>
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>🏪 Status do Estabelecimento</h3>
        </div>
        <div style={{padding:'24px 20px'}}>
          <p style={{fontSize:14,color:'var(--gray-500)',marginBottom:20}}>
            Define se a loja aparece como aberta ou fechada para os clientes no site.
          </p>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {/* Botão Aberto */}
            <button
              onClick={()=>toggle('open')}
              style={{
                flex:1,minWidth:140,padding:'18px 24px',borderRadius:14,cursor:'pointer',
                border: status==='open' ? '2.5px solid #16A34A' : '2px solid var(--gray-200)',
                background: status==='open' ? '#F0FDF4' : 'var(--white)',
                display:'flex',alignItems:'center',gap:12,transition:'all .2s',
                fontFamily:'var(--font-body)',
              }}>
              <span style={{
                width:14,height:14,borderRadius:'50%',flexShrink:0,
                background: status==='open' ? '#22C55E' : '#D1D5DB',
                boxShadow: status==='open' ? '0 0 0 3px rgba(34,197,94,.2)' : 'none',
                transition:'all .2s',
              }}/>
              <div style={{textAlign:'left'}}>
                <div style={{fontWeight:700,fontSize:15,color: status==='open'?'#15803D':'var(--gray-700)'}}>Aberto</div>
                <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Aceita pedidos normalmente</div>
              </div>
              {status==='open' && <span style={{marginLeft:'auto',color:'#16A34A',fontSize:18}}>✓</span>}
            </button>

            {/* Botão Fechado */}
            <button
              onClick={()=>toggle('closed')}
              style={{
                flex:1,minWidth:140,padding:'18px 24px',borderRadius:14,cursor:'pointer',
                border: status==='closed' ? '2.5px solid #DC2626' : '2px solid var(--gray-200)',
                background: status==='closed' ? '#FEF2F2' : 'var(--white)',
                display:'flex',alignItems:'center',gap:12,transition:'all .2s',
                fontFamily:'var(--font-body)',
              }}>
              <span style={{
                width:14,height:14,borderRadius:'50%',flexShrink:0,
                background: status==='closed' ? '#EF4444' : '#D1D5DB',
                boxShadow: status==='closed' ? '0 0 0 3px rgba(239,68,68,.2)' : 'none',
                transition:'all .2s',
              }}/>
              <div style={{textAlign:'left'}}>
                <div style={{fontWeight:700,fontSize:15,color: status==='closed'?'#DC2626':'var(--gray-700)'}}>Fechado</div>
                <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Exibe "Fechado no momento"</div>
              </div>
              {status==='closed' && <span style={{marginLeft:'auto',color:'#DC2626',fontSize:18}}>✓</span>}
            </button>
          </div>

          {/* Preview */}
          <div style={{
            marginTop:20,padding:'12px 16px',borderRadius:10,
            background: status==='open' ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${status==='open'?'#BBF7D0':'#FECACA'}`,
            display:'flex',alignItems:'center',gap:8,fontSize:13,
            color: status==='open'?'#15803D':'#DC2626',fontWeight:600,
            flexWrap:'wrap',
          }}>
            <span style={{width:8,height:8,borderRadius:'50%',
              background: status==='open'?'#22C55E':'#EF4444',flexShrink:0}}/>
            {status==='open' ? '● Aberto agora' : '● Fechado no momento'}
            {status==='closed' && (
              <span style={{
                marginLeft:8,padding:'3px 10px',borderRadius:8,
                background:'rgba(220,38,38,.1)',border:'1px solid rgba(220,38,38,.2)',
                fontSize:11,fontWeight:600,color:'#DC2626',
              }}>📅 Botão "Agendar pedido" visível no site</span>
            )}
            <span style={{marginLeft:'auto',fontSize:11,fontWeight:400,color:'var(--gray-500)'}}>
              Visível imediatamente
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
