/* components/admin/AdminFidelidade.jsx — REF-LOYALTY-01.
   Painel de fidelidade POR CLIENTE (a fonte unica e o Supabase; nao ha mais contador global no
   navegador). Config do programa (required/discount/enabled) e persistida em settings via
   set_loyalty_config; a consulta/ajuste/resgate de um cliente usa admin_find_loyalty /
   admin_adjust_loyalty / redeem_reward. Toda escrita e validada no servidor por is_admin(). */
import { useState, useEffect } from 'react';
import {
  adminLerConfig, adminSalvarConfig, adminBuscar, adminAjustar, adminResgatar,
} from '../../services/loyalty/index.js';

export function AdminFidelidade() {
  /* ── Config do programa ── */
  const [required, setRequired] = useState(10);
  const [discount, setDiscount] = useState(50);
  const [enabled,  setEnabled]  = useState(true);
  const [cfgSaved, setCfgSaved] = useState(false);
  const [cfgErro,  setCfgErro]  = useState('');
  const [cfgLoad,  setCfgLoad]  = useState(true);

  useEffect(() => {
    let vivo = true;
    adminLerConfig().then((c) => { if (!vivo) return; setRequired(c.required); setDiscount(c.discount); setEnabled(c.enabled); setCfgLoad(false); });
    return () => { vivo = false; };
  }, []);

  const salvarConfig = async (over) => {
    const r = over || { required, discount, enabled };
    setCfgErro('');
    const res = await adminSalvarConfig(r.required, r.discount, r.enabled);
    if (res.ok) { setCfgSaved(true); setTimeout(() => setCfgSaved(false), 2500); }
    else setCfgErro(res.error === 'sem permissao' ? 'Sem permissão de administrador.' : 'Não foi possível salvar.');
    return res.ok;
  };

  // Otimista, mas nunca mentiroso: se o backend recusar, desfaz o toggle na tela — sem isto, uma
  // falha de rede/permissao deixava o rotulo "Ativo/Desativado" mostrando um estado que nunca foi
  // persistido (achado real: settings.loyalty_enabled ficou dessincronizado no projeto de E2E).
  const toggleEnabled = async (v) => {
    const anterior = enabled;
    setEnabled(v);
    const ok = await salvarConfig({ required, discount, enabled: v });
    if (!ok) setEnabled(anterior);
  };

  /* ── Consulta/gestão de um cliente ── */
  const [query,    setQuery]    = useState('');
  const [buscando, setBuscando] = useState(false);
  const [buscaErro,setBuscaErro]= useState('');
  const [cliente,  setCliente]  = useState(null);   // {customer_id,name,phone,stamps,required,reward_available,rewards_redeemed}
  const [acting,   setActing]   = useState(false);
  const [actErro,  setActErro]  = useState('');
  const [nota,     setNota]     = useState('');

  const buscar = async () => {
    const q = query.trim();
    if (!q || buscando) return;
    setBuscando(true); setBuscaErro(''); setActErro(''); setCliente(null);
    const r = await adminBuscar(q);
    setBuscando(false);
    if (r.ok) setCliente(r);
    else setBuscaErro(r.error === 'cliente nao encontrado' ? 'Cliente não encontrado.' : (r.error === 'sem permissao' ? 'Sem permissão de administrador.' : 'Falha na busca.'));
  };

  const aplicar = async (fn) => {
    if (!cliente || acting) return;
    setActing(true); setActErro('');
    const r = await fn();
    setActing(false);
    if (r.ok) {
      setCliente((c) => ({ ...c, stamps: r.stamps, required: r.required ?? c.required, reward_available: r.reward_available ?? (r.stamps >= (r.required ?? c.required)), rewards_redeemed: r.rewards_redeemed ?? c.rewards_redeemed }));
      setNota('');
    } else {
      setActErro(r.error === 'recompensa indisponivel' ? 'Recompensa indisponível (cartela incompleta).' : (r.error === 'sem permissao' ? 'Sem permissão de administrador.' : 'Não foi possível concluir.'));
    }
  };

  const ajustar   = (delta) => aplicar(() => adminAjustar(cliente.customer_id, delta, nota));
  const resgatar  = ()      => aplicar(() => adminResgatar(cliente.customer_id));
  const rewardAvail = cliente ? (cliente.reward_available ?? (cliente.stamps >= cliente.required)) : false;

  return (
    <div>
      {/* ── Cabeçalho + status do programa ── */}
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
            Regra: {required} pedidos = {discount}% de desconto · fidelidade por cliente (Supabase)
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
            <input data-testid="fid-form-enabled" type="checkbox" checked={enabled} disabled={cfgLoad} onChange={e=>toggleEnabled(e.target.checked)}/>
            <span className="toggle-slider"/>
          </label>
        </div>
      </div>

      {/* ── Consulta de cliente ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header"><h3>🔎 Fidelidade do cliente</h3></div>
        <div style={{padding:'20px'}}>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:4}}>
            <input className="form-input" style={{flex:1,minWidth:200}}
              placeholder="Telefone (com DDD) ou nome do cliente"
              value={query} onChange={e=>setQuery(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') buscar(); }}/>
            <button className="btn-primary" onClick={buscar} disabled={buscando} style={{minWidth:120}}>
              {buscando ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          {buscaErro && <p style={{fontSize:13,color:'#DC2626',marginTop:8,fontWeight:600}}>{buscaErro}</p>}

          {cliente && (
            <div style={{marginTop:18}}>
              {/* Status do cliente */}
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
                  fontSize:28,
                }}>
                  {rewardAvail ? '🎉' : '🛍️'}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:800,fontSize:16,color:'var(--gray-800)'}}>{cliente.name}</div>
                  <div style={{fontSize:12,color:'var(--gray-500)'}}>{cliente.phone}</div>
                  <div style={{
                    fontFamily:'var(--font-head)',fontSize:26,fontWeight:800,lineHeight:1.1,marginTop:6,
                    color: rewardAvail ? '#15803D' : '#6B21A8',
                  }}>
                    {cliente.stamps}
                    <span style={{fontSize:14,fontWeight:500,color:'var(--gray-400)',marginLeft:4}}>/ {cliente.required} pedidos</span>
                  </div>
                  <div style={{fontSize:12.5,marginTop:4,fontWeight:600,color: rewardAvail ? '#15803D' : 'var(--gray-500)'}}>
                    {rewardAvail
                      ? '🎁 Recompensa disponível'
                      : `Faltam ${Math.max(0, cliente.required - cliente.stamps)} pedido(s)`}
                    {' · '}resgates: {cliente.rewards_redeemed}
                  </div>
                </div>
              </div>

              {/* Ações */}
              <input className="form-input" style={{marginBottom:10}}
                placeholder="Motivo do ajuste (opcional)" value={nota} onChange={e=>setNota(e.target.value)}/>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <button className="btn-sm" disabled={acting} onClick={()=>ajustar(1)}>+ Selo</button>
                <button className="btn-sm" disabled={acting || cliente.stamps<=0} onClick={()=>ajustar(-1)}>− Selo</button>
                <button className="btn-primary" disabled={acting || !rewardAvail} onClick={resgatar} style={{minWidth:180}}>
                  {acting ? 'Processando…' : '✅ Resgatar recompensa'}
                </button>
              </div>
              {actErro && <p style={{fontSize:13,color:'#DC2626',marginTop:10,fontWeight:600}}>{actErro}</p>}
              <p style={{fontSize:11,color:'var(--gray-400)',marginTop:12,lineHeight:1.5}}>
                Ajustes e resgates são registrados no histórico (loyalty_events) e valem globalmente,
                em qualquer dispositivo do cliente. O selo automático é concedido no backend a cada
                pedido válido; cancelamento reverte o selo daquele pedido.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Configurações do programa ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>⚙️ Configurações do Programa</h3>
          {cfgSaved && <span style={{color:'#16A34A',fontSize:13,fontWeight:700}}>✓ Salvo com sucesso!</span>}
        </div>
        <div style={{padding:'20px'}}>
          <div className="form-row" style={{marginBottom:20}}>
            <div className="form-group">
              <label className="form-label">Pedidos para recompensa</label>
              <input data-testid="fid-form-required" className="form-input" type="number" min="1" max="100"
                value={required} onChange={e=>setRequired(+e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="form-label">Desconto da recompensa (%)</label>
              <input data-testid="fid-form-discount" className="form-input" type="number" min="1" max="100"
                value={discount} onChange={e=>setDiscount(+e.target.value)}/>
            </div>
          </div>
          <div style={{
            padding:'12px 16px',background:'var(--gray-50)',borderRadius:10,
            marginBottom:20,fontSize:13,color:'var(--gray-600)',lineHeight:1.6,
          }}>
            <b>Lógica aplicada (backend):</b><br/>
            • Cada <b>pedido válido</b> concede 1 selo ao cliente (idempotente por pedido).<br/>
            • <code>stamps ≥ {required}</code> → recompensa disponível.<br/>
            • Ao resgatar: <code>stamps −= {required}</code>, novo ciclo. Recompensas não são cumulativas.<br/>
            • Pedido <b>cancelado</b> reverte o selo daquele pedido. Frete não é contabilizado.
          </div>
          <button className="btn-primary" onClick={()=>salvarConfig()} disabled={cfgLoad} style={{minWidth:160}}>
            {cfgSaved ? '✓ Salvo!' : '💾 Salvar configurações'}
          </button>
          {cfgErro && <p style={{fontSize:13,color:'#DC2626',marginTop:10,fontWeight:600}}>{cfgErro}</p>}
        </div>
      </div>

      {/* ── Regulamento resumido ── */}
      <div className="admin-card">
        <div className="admin-card-header"><h3>📋 Regulamento do Programa</h3></div>
        <div style={{padding:'20px'}}>
          {[
            ['Elegibilidade','Para participar, o cliente deve possuir cadastro ativo. Em caso de uso indevido ou fraude, a loja pode cancelar os benefícios.'],
            ['Contabilização','O selo é concedido no backend a cada pedido válido. Pedidos cancelados revertem o selo. O valor do frete não é contabilizado.'],
            ['Recompensa','Peça 10 vezes e ganhe 50% de desconto no próximo pedido. O resgate só pode ser feito pelo próprio participante (ou pela loja).'],
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
          <div style={{display:'flex',gap:12,padding:'12px 0'}}>
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
