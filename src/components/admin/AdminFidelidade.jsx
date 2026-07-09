import { useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storage.js';

/* ── Admin: Fidelidade ─────────────────────────────────── */
export function AdminFidelidade() {
  const [count,    setCount]    = useState(()=>parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_COUNT)||'0'));
  const [required, setRequired] = useState(()=>parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_REQUIRED)||'10'));
  const [discount, setDiscount] = useState(()=>parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_DISCOUNT)||'50'));
  const [enabled,  setEnabled]  = useState(()=>localStorage.getItem(STORAGE_KEYS.LOYALTY_ENABLED)!=='false');
  const [saved,    setSaved]    = useState(false);
  const [editReq,  setEditReq]  = useState(false);
  const [editDis,  setEditDis]  = useState(false);
  const rewardAvail = count >= required;

  const saveConfig = () => {
    localStorage.setItem(STORAGE_KEYS.LOYALTY_REQUIRED, String(required));
    localStorage.setItem(STORAGE_KEYS.LOYALTY_DISCOUNT,  String(discount));
    localStorage.setItem(STORAGE_KEYS.LOYALTY_ENABLED,   String(enabled));
    setSaved(true); setEditReq(false); setEditDis(false);
    setTimeout(()=>setSaved(false), 2500);
  };

  const resetCounter = () => {
    if (!window.confirm(
      'Zerar o contador de pedidos?\nEsta ação representa que o cliente usou sua recompensa ou foi feito um ajuste manual.'
    )) return;
    localStorage.setItem(STORAGE_KEYS.LOYALTY_COUNT, '0');
    localStorage.setItem(STORAGE_KEYS.LOYALTY_REWARD_USED,'true');
    setCount(0);
  };

  const addPedido = () => {
    if (count >= required) { alert('Recompensa já disponível. Peça para o cliente usar o desconto antes de adicionar novos pedidos.'); return; }
    const next = count + 1;
    localStorage.setItem(STORAGE_KEYS.LOYALTY_COUNT, String(next));
    setCount(next);
  };

  return (
    <div>
      {/* ── Cabeçalho com status ── */}
      <div style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',
        flexWrap:'wrap',gap:12,marginBottom:20,
        padding:'16px 20px',background:'var(--white)',
        borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-sm)',
      }}>
        <div>
          <h2 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,margin:0}}>
            🎁 Programa de Fidelidade
          </h2>
          <p style={{fontSize:13,color:'var(--gray-500)',marginTop:4}}>
            Regra: {required} pedidos = {discount}% de desconto
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{
            fontSize:12,fontWeight:700,
            color: enabled ? '#15803D' : 'var(--gray-500)',
            background: enabled ? '#F0FDF4' : 'var(--gray-100)',
            padding:'4px 12px',borderRadius:20,
          }}>
            {enabled ? '● Ativo' : '○ Desativado'}
          </span>
          <label className="toggle-switch">
            <input type="checkbox" checked={enabled} onChange={e=>{
              setEnabled(e.target.checked);
              localStorage.setItem(STORAGE_KEYS.LOYALTY_ENABLED,String(e.target.checked));
            }}/>
            <span className="toggle-slider"/>
          </label>
        </div>
      </div>

      {/* ── Progresso do cliente ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>📊 Progresso atual</h3>
          <div style={{display:'flex',gap:8}}>
            <button className="btn-sm" onClick={addPedido} title="Adicionar 1 pedido manualmente">
              + Pedido
            </button>
            <button className="btn-danger" onClick={resetCounter}>
              ↺ Resetar
            </button>
          </div>
        </div>
        <div style={{padding:'20px'}}>
          {/* Card de status */}
          <div style={{
            display:'flex',alignItems:'center',gap:16,
            padding:'18px',borderRadius:14,marginBottom:16,
            background: rewardAvail ? '#F0FDF4' : 'var(--grape-pale)',
            border: `1.5px solid ${rewardAvail?'#BBF7D0':'#DDD6FE'}`,
          }}>
            <div style={{
              width:64,height:64,borderRadius:14,flexShrink:0,
              background: rewardAvail ? '#16A34A' : '#6B21A8',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:28,boxShadow:`0 4px 12px ${rewardAvail?'rgba(22,163,74,.3)':'rgba(107,33,168,.3)'}`,
            }}>
              {rewardAvail ? '🎉' : '🛍️'}
            </div>
            <div style={{flex:1}}>
              <div style={{
                fontFamily:'var(--font-head)',fontSize:32,fontWeight:800,lineHeight:1,
                color: rewardAvail ? '#15803D' : '#6B21A8',
              }}>
                {count}
                <span style={{fontSize:16,fontWeight:500,color:'var(--gray-400)',marginLeft:4}}>
                  / {required} pedidos
                </span>
              </div>
              <div style={{fontSize:13,marginTop:6,fontWeight:600,
                color: rewardAvail ? '#15803D' : 'var(--grape)'}}>
                {rewardAvail
                  ? '🎁 Recompensa disponível! Cliente pode usar o desconto.'
                  : `Faltam ${required-count} pedido(s) para ${discount}% de desconto`}
              </div>
            </div>
          </div>

          {/* Barra */}
          <div style={{marginBottom:4}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-400)',marginBottom:6}}>
              <span>order_count: {count} | reward_available: {rewardAvail?'true':'false'}</span>
              <span>{Math.round((count/required)*100)}%</span>
            </div>
            <div style={{width:'100%',height:12,background:'var(--gray-100)',borderRadius:6,overflow:'hidden'}}>
              <div style={{
                height:'100%',borderRadius:6,
                width:`${Math.min(100,(count/required)*100)}%`,
                background: rewardAvail
                  ? 'linear-gradient(90deg,#16A34A,#4ADE80)'
                  : 'linear-gradient(90deg,#6B21A8,#A855F7)',
                transition:'width .4s',
              }}/>
            </div>
          </div>

          {/* Grade de pedidos */}
          <div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:16}}>
            {Array.from({length:required}).map((_,i)=>(
              <div key={i} style={{
                width:34,height:34,borderRadius:8,
                background: i<count ? 'linear-gradient(135deg,#6B21A8,#A855F7)' : 'var(--gray-100)',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:14,border: i<count ? 'none' : '1px solid var(--gray-200)',
                boxShadow: i<count ? '0 2px 6px rgba(107,33,168,.25)' : 'none',
                title:`Pedido ${i+1}`,
              }}>
                {i<count ? '🛍️' : <span style={{color:'var(--gray-300)'}}>○</span>}
              </div>
            ))}
          </div>

          <p style={{fontSize:11,color:'var(--gray-400)',marginTop:12,lineHeight:1.5}}>
            <b>+Pedido</b>: adiciona 1 pedido manualmente (ex: aprovado pelo sistema).
            <b> Resetar</b>: zera o contador (ex: cliente usou o desconto).
            Os campos <code>order_count</code> e <code>reward_available</code> refletem o estado atual.
          </p>
        </div>
      </div>

      {/* ── Configurações ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>⚙️ Configurações do Programa</h3>
          {saved && <span style={{color:'#16A34A',fontSize:13,fontWeight:700}}>✓ Salvo com sucesso!</span>}
        </div>
        <div style={{padding:'20px'}}>
          <div className="form-row" style={{marginBottom:20}}>
            <div className="form-group">
              <label className="form-label">Pedidos para recompensa</label>
              <input className="form-input" type="number" min="1" max="100"
                value={required} onChange={e=>setRequired(+e.target.value)}/>
              <span style={{fontSize:11,color:'var(--gray-400)',marginTop:3,display:'block'}}>
                Campo: <code>order_count</code> — padrão: 10
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Desconto da recompensa (%)</label>
              <input className="form-input" type="number" min="1" max="100"
                value={discount} onChange={e=>setDiscount(+e.target.value)}/>
              <span style={{fontSize:11,color:'var(--gray-400)',marginTop:3,display:'block'}}>
                Campo: <code>reward_discount</code> — padrão: 50
              </span>
            </div>
          </div>
          <div style={{
            padding:'12px 16px',background:'var(--gray-50)',borderRadius:10,
            marginBottom:20,fontSize:13,color:'var(--gray-600)',lineHeight:1.6,
          }}>
            <b>Lógica aplicada:</b><br/>
            • <code>order_count ≥ {required}</code> → <code>reward_available = true</code><br/>
            • Ao usar o desconto: <code>order_count = 0</code>, <code>reward_available = false</code>, <code>reward_used = true</code><br/>
            • Valor do frete não é contabilizado — somente products.<br/>
            • Recompensas não são cumulativas (1 por ciclo).
          </div>
          <button className="btn-primary" onClick={saveConfig} style={{minWidth:160}}>
            {saved ? '✓ Salvo!' : '💾 Salvar configurações'}
          </button>
        </div>
      </div>

      {/* ── Regulamento resumido ── */}
      <div className="admin-card">
        <div className="admin-card-header"><h3>📋 Regulamento do Programa</h3></div>
        <div style={{padding:'20px'}}>
          {[
            ['Elegibilidade','Para participar, o cliente deve possuir cadastro ativo. Em caso de uso indevido ou fraude, a loja pode cancelar os benefícios.'],
            ['Contabilização','O pedido só contabiliza após ser aprovado ou finalizado pela loja. O valor do frete não é contabilizado.'],
            ['Recompensa','Peça 10 vezes e ganhe 50% de desconto no próximo pedido. O resgate só pode ser feito pelo próprio participante.'],
            ['Validade','O programa é válido por tempo indeterminado. A loja pode alterar regras, duração ou benefícios a qualquer momento.'],
            ['Encerramento','Em caso de encerramento, pontos e recompensas poderão ser zerados.'],
          ].map(([t,d])=>(
            <div key={t} style={{
              display:'flex',gap:12,padding:'12px 0',
              borderBottom:'1px solid var(--gray-100)',
            }}>
              <div style={{
                fontSize:12,fontWeight:700,color:'var(--amarelo)',
                minWidth:110,flexShrink:0,paddingTop:1,
              }}>{t}</div>
              <div style={{fontSize:13,color:'var(--gray-600)',lineHeight:1.55}}>{d}</div>
            </div>
          ))}
          <div style={{
            display:'flex',gap:12,padding:'12px 0',
          }}>
            <div style={{fontSize:12,fontWeight:700,color:'var(--amarelo)',minWidth:110,flexShrink:0}}>Contato</div>
            <div style={{fontSize:13,color:'var(--gray-600)'}}>
              <a href="https://wa.me/5538992203620" target="_blank"
                style={{color:'var(--amarelo)',fontWeight:600}}>
                WhatsApp: (38) 99220-3620
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
