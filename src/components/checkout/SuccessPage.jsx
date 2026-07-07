/* components/checkout/SuccessPage.jsx — REF-APP-01 · Onda 5.1 (move puro do App.jsx L230-292).
   Tela de confirmacao do pedido (apresentacional): abre o WhatsApp com a msg pronta e mostra
   tempo estimado + barra de status cosmetica. Sem DS, sem carrinho (prop 'cart' preservada mas nao usada). */
import { useState } from 'react';
import { WHATSAPP } from '../../lib/supabase.js';

export function SuccessPage({ msg, cart, onBack }) {
  const open = () => window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`,'_blank');
  /* Tempo estimado dinâmico */
  const [tempo, setTempo] = useState(()=>30+Math.floor(Math.random()*20));
  const [statusIdx, setStatusIdx] = useState(0);
  const steps = [
    {label:'Recebido',   icon:'📥'},
    {label:'Em preparo', icon:'👨‍🍳'},
    {label:'Pronto',     icon:'✅'},
    {label:'Em entrega', icon:'🛵'},
    {label:'Entregue',   icon:'🏠'},
  ];
  return (
    <div className="success-page" style={{maxWidth:520,padding:'28px 16px 40px'}}>
      <div className="success-icon" style={{fontSize:56}}>🎉</div>
      <h2 style={{marginBottom:6}}>Pedido realizado com sucesso!</h2>
      <p style={{marginBottom:20}}>
        Nossa equipe confirmará em instantes. Envie pelo WhatsApp para agilizar! 💜
      </p>

      {/* Tempo estimado */}
      <div style={{
        background:'var(--grape-pale)',borderRadius:12,padding:'12px 20px',
        marginBottom:20,display:'flex',alignItems:'center',justifyContent:'space-between',
      }}>
        <div>
          <div style={{fontSize:12,color:'var(--amarelo)',fontWeight:600,marginBottom:2}}>
            🕐 Tempo estimado de entrega
          </div>
          <div style={{fontFamily:'var(--font-head)',fontSize:24,fontWeight:800,color:'var(--amarelo)'}}>
            {tempo}–{tempo+10} min
          </div>
        </div>
        <div style={{fontSize:11,color:'var(--gray-500)',textAlign:'right',lineHeight:1.4}}>
          Seg–Dom<br/>11:00 às 22:30
        </div>
      </div>

      {/* Barra de status do pedido */}
      <div className="order-status-bar" style={{marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--gray-700)',marginBottom:12}}>
          Acompanhe seu pedido
        </div>
        <div className="order-status-steps">
          {steps.map((s,i)=>(
            <div key={i} className={`order-status-step ${i<statusIdx?'done':i===statusIdx?'active':''}`}>
              <div className="step-dot">{i<statusIdx?'✓':s.icon}</div>
              <div className="step-label">{s.label}</div>
            </div>
          ))}
        </div>
        <p style={{fontSize:11,color:'var(--gray-400)',marginTop:12,textAlign:'center'}}>
          Status atualizado após confirmação pela loja via WhatsApp.
        </p>
      </div>

      <button className="whatsapp-btn" onClick={open} style={{width:'100%',justifyContent:'center',marginBottom:10}}>
        <span style={{fontSize:22}}>💬</span> Enviar pedido pelo WhatsApp
      </button>
      <button className="back-home-btn" onClick={onBack}>← Voltar ao cardápio</button>
    </div>
  );
}
