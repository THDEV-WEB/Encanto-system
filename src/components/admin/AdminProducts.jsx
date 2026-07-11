import { useState, useEffect } from 'react';
import { DS } from '../../services/DataService.js';
import { MOCK_CATS, MOCK_PRODS } from '../../data/mockCatalog.js';
import { precoVitrine } from '../../utils/pricing.js';
import { fmt } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';
import { ImageUploader } from './ImageUploader.jsx';

export function AdminProducts() {
  const [prods, setProds] = useState([]);
  const [cats,  setCats]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState('');
  const [modal,    setModal]    = useState(null);

  // Estado do formulário — image_url usa sentinel KEEP para preservar imagem existente
  const KEEP = '__KEEP__'; // sentinel: não alterar image_url no banco
  const ef = {nome:'',descricao:'',preco:'',preco_promo:'',categoria_id:'',
    imagem_url: KEEP, // ao criar, começar vazio
    disponivel:true,destaque:false,adicionais_gratis:0,badge:'',tamanhos:[]};
  const [form, setForm] = useState(ef);

  const load = async () => {
    setLoading(true);
    try {
      const [p,c] = await Promise.all([DS.getAllProds(), DS.getAllCats()]);
      setProds(p ?? MOCK_PRODS);
      setCats(c ?? MOCK_CATS);
    } catch(e) {
      console.error('[AdminProducts] load error:', e);
      setProds(MOCK_PRODS); setCats(MOCK_CATS);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  /* Abrir modal de edição — carrega a imagem existente no form */
  const openEdit = (p) => {
    setForm({
      nome:             p.nome,
      descricao:        p.descricao || '',
      preco:            p.preco,
      preco_promo:      p.preco_promo || '',
      categoria_id:     p.categoria_id || '',
      // CRÍTICO: carregar imagem existente — será preservada se não enviar nova
      imagem_url:       p.imagem_url || KEEP,
      disponivel:       p.disponivel,
      destaque:         p.destaque || false,
      adicionais_gratis: p.adicionais_gratis || 0,
      badge:            p.badge || '',
      // PRICE-DOMAIN-01: carrega o array de tamanhos (copia profunda 1 nivel p/ nao mutar o produto)
      tamanhos:         Array.isArray(p.tamanhos) ? p.tamanhos.map(t=>({...t})) : [],
    });
    setSaveErr('');
    setModal(p);
  };

  /* Abrir modal de criação */
  const openNew = () => {
    setForm({ ...ef, imagem_url: '', categoria_id: cats[0]?.id || '', tamanhos: [] });
    setSaveErr('');
    setModal('new');
  };

  /* Callback do ImageUploader — atualiza imagem no form */
  const handleImageUploaded = (url) => {
    // url pode ser null (remoção) ou string válida (nova imagem)
    setForm(f => ({ ...f, imagem_url: url || null }));
  };

  /* ── Tamanhos (PRICE-DOMAIN-01) — editor do array de precos por tamanho ────────
     Produto COM tamanhos: preco/preco_promo do topo ficam ocultos; o preco efetivo
     (vitrine + checkout) vem de tamanhos[].preco. Editor add/remove/edita cada tamanho. */
  const temTamanhos = Array.isArray(form.tamanhos) && form.tamanhos.length > 0;
  const addTamanho = () => setForm(f => ({ ...f, tamanhos: [...(f.tamanhos||[]), { label:'', preco:'', adicionais_gratis:0 }] }));
  const updTamanho = (i, patch) => setForm(f => ({ ...f, tamanhos: (f.tamanhos||[]).map((t,idx)=> idx===i ? { ...t, ...patch } : t) }));
  const delTamanho = (i) => setForm(f => ({ ...f, tamanhos: (f.tamanhos||[]).filter((_,idx)=>idx!==i) }));

  const save = async () => {
    const usaTamanhos = Array.isArray(form.tamanhos) && form.tamanhos.length > 0;

    if (!form.nome) { setSaveErr('Nome é obrigatório.'); return; }

    // PRICE-DOMAIN-01: validar/normalizar tamanhos (fonte única do preço quando existem)
    let tamanhosNorm = null;
    if (usaTamanhos) {
      const norm = [];
      for (const t of form.tamanhos) {
        const label = (t.label || '').trim();
        const preco = Number(t.preco);
        if (!label)       { setSaveErr('Cada tamanho precisa de um nome/volume.'); return; }
        if (!(preco > 0)) { setSaveErr(`Preço inválido no tamanho "${label}".`); return; }
        norm.push({ ...t, label, preco, adicionais_gratis: Number(t.adicionais_gratis) || 0 }); // preserva id/chaves existentes
      }
      const labels = norm.map(t => t.label.toLowerCase());
      if (new Set(labels).size !== labels.length) { setSaveErr('Há tamanhos com o mesmo nome/volume.'); return; }
      tamanhosNorm = norm;
    } else if (!form.preco) {
      setSaveErr('Preço é obrigatório.'); return;
    }

    setSaving(true); setSaveErr('');
    try {
      const isNew = modal === 'new';
      const id    = isNew ? null : modal.id;

      const data = {
        nome:             form.nome,
        descricao:        form.descricao || null,
        categoria_id:     form.categoria_id || null,
        disponivel:       form.disponivel,
        destaque:         form.destaque,
        adicionais_gratis: +form.adicionais_gratis || 0,
        badge:            form.badge || null,
      };

      if (usaTamanhos) {
        // Fonte única do preço = tamanhos. Espelha preco = MENOR tamanho e zera promo,
        // para o banco NUNCA guardar um preço divergente/oculto (regra 10 do PRICE-DOMAIN-01).
        data.tamanhos    = tamanhosNorm;
        data.preco       = Math.min(...tamanhosNorm.map(t => t.preco));
        data.preco_promo = null;
      } else {
        // Produto simples: garante que não sobra `tamanhos` antigo e usa preco/preco_promo.
        data.tamanhos    = null;
        data.preco       = +form.preco;
        data.preco_promo = form.preco_promo ? +form.preco_promo : null;
      }

      // REGRA CRÍTICA DE IMAGEM:
      // - KEEP sentinel → não incluir image_url no payload (preserva existente no banco)
      // - null explícito → salvar null (admin quis remover)
      // - URL válida → salvar nova URL
      if (form.imagem_url !== KEEP) {
        data.imagem_url = form.imagem_url; // DS.upsertProd vai sanitizar
      }
      // Se KEEP: não adiciona image_url ao payload → banco mantém valor atual

      await DS.upsertProd(data, id);
      setModal(null);
      await load();
    } catch(err) {
      console.error('[AdminProducts] save error:', err);
      setSaveErr(err.message || 'Erro ao salvar produto.');
    } finally {
      setSaving(false);
    }
  };

  /* Determina a URL atual da imagem para o ImageUploader */
  const currentImageUrl = (() => {
    if (form.imagem_url === KEEP) {
      // Em modo edição: buscar imagem atual do produto
      if (modal && modal !== 'new') return modal.imagem_url || null;
      return null;
    }
    return form.imagem_url || null;
  })();

  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Products ({prods.length})</h3>
          <button className="btn-primary" onClick={openNew}>+ Novo</button>
        </div>
        {loading ? <Spinner/> : (
          <div style={{overflowX:'auto'}}>
            <table className="data-table">
              <thead><tr>
                <th>Imagem</th><th>Produto</th><th>Categoria</th>
                <th>Preço</th><th>Disp.</th><th>Ações</th>
              </tr></thead>
              <tbody>{prods.map(p => (
                <tr key={p.id}>
                  <td>
                    {/* Miniatura da imagem com fallback */}
                    <div style={{
                      width:44,height:44,borderRadius:8,overflow:'hidden',
                      background:'var(--gray-100)',display:'flex',
                      alignItems:'center',justifyContent:'center',flexShrink:0,
                    }}>
                      {p.imagem_url && p.imagem_url.startsWith('http') ? (
                        <img src={p.imagem_url} alt={p.nome}
                          style={{width:'100%',height:'100%',objectFit:'cover'}}
                          onError={e=>{ e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}/>
                      ) : null}
                      <span style={{fontSize:20,display: p.imagem_url ? 'none' : 'flex'}}>
                        {p.imagem_url ? '⚠️' : '🍽️'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{fontWeight:700}}>{p.nome}</div>
                    <div style={{fontSize:11,color:'var(--gray-500)'}}>{p.descricao?.slice(0,38)}</div>
                    {(!p.imagem_url || p.imagem_url.startsWith('data:')) && (
                      <div style={{fontSize:10,color:'#DC2626',fontWeight:600,marginTop:2}}>
                        ⚠️ Sem imagem
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-purple">
                      {p.categorias?.nome || cats.find(c=>c.id===p.categoria_id)?.nome || '-'}
                    </span>
                  </td>
                  <td>
                    <div style={{fontWeight:700,color:'var(--amarelo)'}}>{fmt(precoVitrine(p))}</div>
                    {p.preco_promo && (
                      <div style={{fontSize:11,color:'var(--gray-400)',textDecoration:'line-through'}}>{fmt(p.preco)}</div>
                    )}
                  </td>
                  <td>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={!!p.disponivel}
                        onChange={async()=>{ await DS.toggleProd(p.id,!p.disponivel); load(); }}/>
                      <span className="toggle-slider"/>
                    </label>
                  </td>
                  <td style={{display:'flex',gap:8}}>
                    <button className="btn-sm" onClick={()=>openEdit(p)}>✏️</button>
                    <button className="btn-danger" onClick={async()=>{
                      if(window.confirm('Excluir produto?')) { await DS.delProd(p.id); load(); }
                    }}>🗑</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal-form" style={{maxHeight:'90vh',overflowY:'auto'}}>
            <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,marginBottom:20}}>
              {modal==='new' ? '+ Novo Produto' : '✏️ Editar Produto'}
            </h3>

            <div className="form-group">
              <label className="form-label">Nome *</label>
              <input className="form-input" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/>
            </div>

            <div className="form-group">
              <label className="form-label">Descrição</label>
              <textarea className="form-input obs-textarea" value={form.descricao}
                onChange={e=>setForm(f=>({...f,descricao:e.target.value}))}/>
            </div>

            {/* PRICE-DOMAIN-01: preco/preco_promo aparecem SO para produto simples (sem tamanhos) */}
            {!temTamanhos && (
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Preço (R$) *</label>
                  <input className="form-input" type="number" step="0.01" value={form.preco}
                    onChange={e=>setForm(f=>({...f,preco:e.target.value}))}/>
                </div>
                <div className="form-group">
                  <label className="form-label">Preço Promo</label>
                  <input className="form-input" type="number" step="0.01" value={form.preco_promo}
                    onChange={e=>setForm(f=>({...f,preco_promo:e.target.value}))}/>
                </div>
              </div>
            )}

            {/* ── Tamanhos (PRICE-DOMAIN-01) — editor completo do array de precos por tamanho ── */}
            <div className="form-group">
              <label className="form-label">
                Tamanhos
                <span style={{fontSize:10,color:'var(--gray-400)',fontWeight:400,marginLeft:6}}>
                  {temTamanhos
                    ? '(o preço vem dos tamanhos — o campo Preço acima fica oculto)'
                    : '(opcional — ex.: Monte seu Copo / Batidinhas, preço por tamanho)'}
                </span>
              </label>

              {temTamanhos && form.tamanhos.map((t,i)=>(
                <div key={i} style={{display:'flex',gap:8,marginBottom:8,alignItems:'flex-end',flexWrap:'wrap'}}>
                  <div style={{flex:'2 1 130px'}}>
                    <label className="form-label" style={{fontSize:11}}>Nome / volume *</label>
                    <input className="form-input" placeholder="300 ml" value={t.label||''}
                      onChange={e=>updTamanho(i,{label:e.target.value})}/>
                  </div>
                  <div style={{flex:'1 1 90px'}}>
                    <label className="form-label" style={{fontSize:11}}>Preço (R$) *</label>
                    <input className="form-input" type="number" step="0.01" placeholder="0.00"
                      value={t.preco ?? ''} onChange={e=>updTamanho(i,{preco:e.target.value})}/>
                  </div>
                  <div style={{flex:'1 1 90px'}}>
                    <label className="form-label" style={{fontSize:11}}>Adic. grátis</label>
                    <input className="form-input" type="number" min="0"
                      value={t.adicionais_gratis ?? 0} onChange={e=>updTamanho(i,{adicionais_gratis:e.target.value})}/>
                  </div>
                  <button type="button" className="btn-danger" title="Remover tamanho"
                    style={{flexShrink:0}} onClick={()=>delTamanho(i)}>🗑</button>
                </div>
              ))}

              <button type="button" className="btn-secondary" style={{marginTop:4}} onClick={addTamanho}>
                + Adicionar tamanho
              </button>

              {temTamanhos && (
                <div style={{fontSize:11,color:'var(--gray-500)',marginTop:6,lineHeight:1.5}}>
                  A loja mostra o menor preço como “a partir de” na vitrine e cobra o preço do tamanho
                  escolhido no checkout. Ao salvar, o campo <b>Preço</b> do produto é sincronizado com o menor tamanho.
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Categoria</label>
              <select className="form-select" value={form.categoria_id}
                onChange={e=>setForm(f=>({...f,categoria_id:e.target.value}))}>
                <option value="">Selecione...</option>
                {cats.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Badge de destaque</label>
              <select className="form-select" value={form.badge}
                onChange={e=>setForm(f=>({...f,badge:e.target.value}))}>
                <option value="">Sem badge</option>
                <option value="mais_vendido">⭐ Mais vendido</option>
                <option value="favorito">💜 Favorito dos clientes</option>
                <option value="novo">✨ Novo</option>
                <option value="promocao">🔥 Promoção</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Adicionais grátis (qtd)</label>
              <input className="form-input" type="number" min="0" max="10" placeholder="0"
                value={form.adicionais_gratis}
                onChange={e=>setForm(f=>({...f,adicionais_gratis:+e.target.value}))}/>
            </div>

            {/* ── IMAGEM — componente corrigido ─────────────────── */}
            <div className="form-group">
              <label className="form-label">
                Imagem do produto
                {modal !== 'new' && (
                  <span style={{fontSize:10,color:'var(--gray-400)',fontWeight:400,marginLeft:6}}>
                    (deixe em branco para manter a atual)
                  </span>
                )}
              </label>
              <ImageUploader
                currentUrl={currentImageUrl}
                onUpload={handleImageUploaded}
              />
            </div>

            <div style={{display:'flex',gap:20,marginBottom:16,alignItems:'center'}}>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:14,cursor:'pointer'}}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={form.disponivel}
                    onChange={e=>setForm(f=>({...f,disponivel:e.target.checked}))}/>
                  <span className="toggle-slider"/>
                </label>
                Disponível
              </label>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:14,cursor:'pointer'}}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={form.destaque}
                    onChange={e=>setForm(f=>({...f,destaque:e.target.checked}))}/>
                  <span className="toggle-slider"/>
                </label>
                Destaque
              </label>
            </div>

            {saveErr && (
              <div style={{padding:'10px 12px',borderRadius:8,background:'var(--red-pale)',
                border:'1px solid #FECACA',fontSize:13,color:'var(--red)',
                fontWeight:600,marginBottom:12}}>
                ⚠️ {saveErr}
              </div>
            )}

            <div style={{display:'flex',gap:10}}>
              <button className="btn-secondary" disabled={saving} onClick={()=>setModal(null)}>
                Cancelar
              </button>
              <button className="btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Salvando...' : 'Salvar produto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
