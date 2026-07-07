/* components/ProductModal/ProductModalInner.jsx — REF-APP-01 · Onda 4 (move puro do App.jsx).
   Conteudo do modal de produto (tamanhos, adicionais, upsell, quantidade). Stateful, apresentacional.
   Consumidor de dominio (utils/addons) -> allowlist D1 do test:deps. */
import React, { useState } from 'react';
import { fmt, precoTamanho } from '../../utils/format.js';
import { ADICIONAL_SIMPLES_PRECO, agruparPorGrupo, cotaGratis, ehAdicionalGratis, resolverPrecoAdicionais } from '../../utils/addons.js';
import { catEmoji } from '../../utils/catalog.js';
export function ProductModalInner({ prod, catNome, adicionais, onClose, onAdd, onSuggest }) {
  const [qty,      setQty]      = useState(1);
  const [sel,      setSel]      = useState([]);
  const [obs,      setObs]      = useState('');
  const [variante, setVariante] = useState('');
  const [tamanho,  setTamanho]  = useState(null); /* Produtos com tamanhos: Monte seu Copo, Batidinhas — objeto {label,preco,adicionais_gratis} */
  if (!prod) return null;

  /* ── Grupos de adicionais separados por tipo ── */
  const adsByGrupo  = agruparPorGrupo(adicionais, prod);
  const grupos      = Object.keys(adsByGrupo);
  const temTamanhos = Array.isArray(prod.tamanhos) && prod.tamanhos.length>0;
  const gratis_max  = cotaGratis(prod, tamanho);

  /* Elegível à franquia grátis (simples). Contagem derivada da seleção atual. */
  const allGratis   = adicionais.filter(ehAdicionalGratis);
  const ehGratisAd  = ad => !!allGratis.find(g=>g.id===ad.id);
  const selGratisN  = sel.filter(ehGratisAd).length;
  const gratisSobrando = Math.max(0, gratis_max - selGratisN);

  /* Preço efetivo da seleção pela franquia grátis (engine única em addons.js). */
  const selComPreco = resolverPrecoAdicionais(sel, gratis_max, ehGratisAd);
  const precoEfetivo = ad => selComPreco.find(a=>a.id===ad.id)?.preco;

  const toggle = ad => {
    setSel(p => p.find(a=>a.id===ad.id) ? p.filter(a=>a.id!==ad.id) : [...p, ad]);
  };

  const itemLabel = ad => {
    const ef = precoEfetivo(ad);
    if (ef !== undefined) return ef===0 ? 'Grátis' : `+${fmt(ef)}`;
    if (ehGratisAd(ad) && gratisSobrando>0) return 'Grátis';
    return `+${fmt(Number(ad.preco)||ADICIONAL_SIMPLES_PRECO)}`;
  };

  const adTot = selComPreco.reduce((a,ad)=>a+Number(ad.preco),0);
  const basePreco = temTamanhos ? (precoTamanho(tamanho||prod.tamanhos[0]) || Number(prod.preco)) : Number(prod.preco_promo||prod.preco);
  const unit  = basePreco + adTot;

  /* Upsell de bebida: usa flag do produto ou fallback por nome */
  const showUpsell = prod.upsell_bebida === true ||
    (prod.upsell_bebida === undefined &&
     (catNome||prod.nome).toLowerCase().match(/marmita|açaí|acai|copo|batidinha/));

  /* Rótulos: combo → específico; produto único → genérico "Adicionais" */
  const isCombo = grupos.length > 1;
  const GRUPO_LABEL = {
    marmita: isCombo ? '🍱 Adicionais da Marmita' : 'Adicionais',
    acai:    isCombo ? '🍇 Adicionais do Açaí'    : 'Adicionais',
    bebida:  isCombo ? '🧃 Adicionais da Bebida'  : 'Adicionais',
    simples: '🥄 Adicionais Simples',
    premium: '⭐ Premium',
    frutas_premium: '🍓 Frutas Premium',
    chocolates: '🍫 Chocolates',
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        {prod.imagem_url && prod.imagem_url.startsWith('http')
          ? <img loading="lazy" className="modal-img" src={prod.imagem_url} alt={prod.nome}
              onError={e=>{ e.target.onerror=null; e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}/>
          : null}
        <div className="modal-img" style={{display: prod.imagem_url && prod.imagem_url.startsWith('http') ? 'none' : 'flex'}}>
          {catEmoji(catNome||prod.nome)}
        </div>
        <div className="modal-body">
          <div className="modal-title">{prod.nome}</div>
          {prod.descricao && <div className="modal-desc">{prod.descricao}</div>}
          <div className="modal-price">{fmt(temTamanhos ? precoTamanho(tamanho||prod.tamanhos[0]) : (prod.preco_promo||prod.preco))}</div>

          {/* Composição fixa (ex.: Batidinhas) — só renderiza se houver dado no produto */}
          {Array.isArray(prod.composicao) && prod.composicao.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-title">🥤 Composição</div>
              <div style={{fontSize:13,color:'var(--gray-600)',lineHeight:1.6}}>
                {prod.composicao.join(' • ')}
              </div>
            </div>
          )}

          {/* ── Seleção de tamanho (obrigatório) — Monte seu Copo, Batidinhas ── */}
          {temTamanhos && (
            <div className="modal-section">
              <div className="modal-section-title">
                📏 Escolha o tamanho
                <span style={{fontSize:11,color:'var(--orange)',marginLeft:8,fontWeight:600}}>Obrigatório</span>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                {prod.tamanhos.map(t=>(
                  <button key={t.label}
                    onClick={()=>setTamanho(t)}
                    style={{
                      padding:'8px 16px',borderRadius:20,cursor:'pointer',
                      border:`2px solid ${(tamanho?.label||prod.tamanhos[0].label)===t.label?'var(--grape)':'var(--gray-200)'}`,
                      background:(tamanho?.label||prod.tamanhos[0].label)===t.label?'var(--grape-pale)':'var(--white)',
                      color:(tamanho?.label||prod.tamanhos[0].label)===t.label?'var(--grape)':'var(--gray-600)',
                      fontSize:13,fontWeight:700,fontFamily:'var(--font-body)',
                      transition:'all .15s',
                    }}>
                    {t.label} • {fmt(precoTamanho(t))}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Aviso informativo (ex: Marmita Fitness) ── */}
          {prod.aviso && (
            <div style={{
              background:'var(--grape-pale)',border:'1px solid #DDD6FE',
              borderRadius:12,padding:'12px 14px',marginBottom:8,
            }}>
              <p style={{fontSize:13,color:'var(--amarelo)',fontWeight:600,lineHeight:1.6,margin:0}}>
                ℹ️ {prod.aviso}
              </p>
            </div>
          )}

          {/* ── Seleção de variante obrigatória (ex: tipo de suco ou tamanho) ── */}
          {(prod.variantes||[]).length > 0 && (
            <div className="modal-section">
              <div className="modal-section-title">
                {(prod.variantes||[]).some(v=>/\d+\s*ml/i.test(v)) ? '📏 Escolha o tamanho' : '🧃 Escolha o sabor'}
                <span style={{fontSize:11,color:'var(--orange)',marginLeft:8,fontWeight:600}}>Obrigatório</span>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                {prod.variantes.map(v=>(
                  <button key={v}
                    onClick={()=>setVariante(v)}
                    style={{
                      padding:'8px 16px',borderRadius:20,cursor:'pointer',
                      border:`2px solid ${variante===v?'var(--grape)':'var(--gray-200)'}`,
                      background: variante===v?'var(--grape-pale)':'var(--white)',
                      color: variante===v?'var(--grape)':'var(--gray-600)',
                      fontSize:13,fontWeight:700,fontFamily:'var(--font-body)',
                      transition:'all .15s',
                    }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Adicionais por grupo (Marmita / Açaí / etc.) ── */}
          {grupos.map(grupo => {
            const adsGrupo   = adsByGrupo[grupo] || [];
            const gratisList = adsGrupo.filter(ehAdicionalGratis);
            const pagosList  = adsGrupo.filter(a=>a.tipo==='pago'&&Number(a.preco)>0);
            if (adsGrupo.length===0) return null;
            return (
              <div key={grupo} className="modal-section">
                {/* Título do grupo + contador global de grátis */}
                <div className="modal-section-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{GRUPO_LABEL[grupo]||grupo}</span>
                  {gratis_max>0 && gratisList.length>0 && (
                    <span style={{fontSize:11,fontWeight:700,
                      color: gratisSobrando>0?'var(--green)':'var(--gray-400)',
                      background: gratisSobrando>0?'var(--green-pale)':'var(--gray-100)',
                      padding:'2px 8px',borderRadius:10}}>
                      {gratisSobrando>0?`${gratisSobrando} grátis restante${gratisSobrando!==1?'s':''}`:'Limite atingido'}
                    </span>
                  )}
                </div>
                {/* Grátis deste grupo */}
                {gratisList.map(ad=>(
                  <div key={ad.id} className="additional-item" onClick={()=>toggle(ad)}>
                    <div className={`additional-check ${sel.find(a=>a.id===ad.id)?'checked':''}`}>
                      {sel.find(a=>a.id===ad.id)&&'✓'}
                    </div>
                    <div className="additional-info">
                      <div className="additional-name">{ad.nome}</div>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,
                      color:precoEfetivo(ad)===0?'var(--green)':'var(--gray-400)'}}>
                      {itemLabel(ad)}
                    </span>
                  </div>
                ))}
                {/* Pagos deste grupo — subdivididos por subgrupo_label quando disponível */}
                {pagosList.length>0 && (() => {
                  /* Agrupar por subgrupo_label preservando a ordem de inserção */
                  const subgrupos = [];
                  const subgrupoMap = {};
                  pagosList.forEach(ad => {
                    const sg = ad.subgrupo_label || '';
                    if (!(sg in subgrupoMap)) { subgrupoMap[sg]=[]; subgrupos.push(sg); }
                    subgrupoMap[sg].push(ad);
                  });
                  return (
                    <>
                      {subgrupos.map(sg => (
                        <React.Fragment key={sg||'_'}>
                          {sg && (
                          <div style={{fontSize:12,fontWeight:800,color:'#DC2626',
                            textTransform:'uppercase',letterSpacing:'.5px',
                            margin:'14px 0 6px',padding:'6px 10px',
                            background:'#FEF2F2',borderRadius:7,
                            border:'1.5px solid #FECACA',
                            display:'flex',alignItems:'center',gap:5}}>
                            <span style={{fontSize:14}}>⚠️</span> {sg}
                          </div>
                          )}
                          {subgrupoMap[sg].map(ad=>(
                            <div key={ad.id} className="additional-item" onClick={()=>toggle(ad)}>
                              <div className={`additional-check ${sel.find(a=>a.id===ad.id)?'checked':''}`}>
                                {sel.find(a=>a.id===ad.id)&&'✓'}
                              </div>
                              <div className="additional-info">
                                <div className="additional-name">{ad.nome}</div>
                                <div className="additional-price">+{fmt(ad.preco||ADICIONAL_SIMPLES_PRECO)}</div>
                              </div>
                            </div>
                          ))}
                        </React.Fragment>
                      ))}
                    </>
                  );
                })()}
              </div>
            );
          })}

          <div className="modal-section">
            <div className="modal-section-title">Observações</div>
            {/* Marmita Fitness: campos detalhados de personalização */}
            {prod.obs_campos && prod.obs_campos.length > 0 ? (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {prod.obs_campos.map((campo,i)=>(
                  <div key={i}>
                    <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:3}}>
                      {campo}
                    </label>
                    <input
                      className="form-input"
                      style={{fontSize:13,padding:'8px 12px'}}
                      placeholder={`Ex: ${campo.toLowerCase()}...`}
                      onChange={e=>{
                        const vals = obs ? JSON.parse(obs) : {};
                        vals[campo] = e.target.value;
                        setObs(JSON.stringify(vals));
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <textarea className="obs-textarea"
                placeholder="Sua observação aqui."
                value={obs} onChange={e=>setObs(e.target.value)}/>
            )}
          </div>
        </div>
        {/* ── ALT 8: Sugestão de bebida se for marmita ou açaí ── */}
        {showUpsell && onSuggest && (
          <div className="upsell-banner" onClick={()=>{onSuggest();onClose();}}>
            <span style={{fontSize:20}}>🧃</span>
            <div className="upsell-text">Adicionar uma bebida ao pedido?</div>
            <span className="upsell-action">Ver bebidas →</span>
          </div>
        )}
        <div className="modal-footer">
          <button className="modal-close" onClick={onClose}>✕</button>
          <div className="qty-control">
            <button className="qty-btn" onClick={()=>setQty(q=>Math.max(1,q-1))}>−</button>
            <span className="qty-value">{qty}</span>
            <button className="qty-btn" onClick={()=>setQty(q=>q+1)}>+</button>
          </div>
          <button className="add-to-cart-btn" onClick={()=>{
              const variantesArr = Array.isArray(prod.variantes) ? prod.variantes : [];
              if (variantesArr.length>0 && !variante) {
                alert(variantesArr.some(v=>/\d+\s*ml/i.test(v))?'Escolha o tamanho antes de continuar!':'Escolha o sabor antes de continuar!'); return;
              }
              const varLabel = variantesArr.some(v=>/\d+\s*ml/i.test(v)) ? 'Tamanho' : 'Sabor';

              let obsCompleto = variante ? `[${varLabel}: ${variante}]${obs?' — '+obs:''}` : obs;
              let prodParaCarrinho = prod;
              if (temTamanhos) {
                const tSel = tamanho || prod.tamanhos[0];
                obsCompleto = `[Tamanho: ${tSel.label}]${obs?' — '+obs:''}`;
                /* Preço do item refletindo o tamanho escolhido */
                prodParaCarrinho = {...prod, preco: precoTamanho(tSel), preco_promo: null};
              }

              console.log('[ENCANTO] Adicionar clicado. prod.id=', prod.id, 'qty=', qty, 'sel=', sel, 'obs=', obsCompleto);
              onAdd(prodParaCarrinho,qty,selComPreco,obsCompleto);
              console.log('[ENCANTO] onAdd executado.');
              onClose();
            }}>
            <span>Adicionar</span>
            <span>{fmt(unit*qty)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
