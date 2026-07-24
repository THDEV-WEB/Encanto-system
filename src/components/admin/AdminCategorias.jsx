import { useState, useEffect } from 'react';
import { DS } from '../../services/DataService.js';
import { MOCK_CATS } from '../../data/mockCatalog.js';
import { Spinner } from '../ui/Spinner.jsx';

export function AdminCategorias() {
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({nome:'',icone:'🍽️',cor:'#6B21A8',ordem:0});
  const [erro, setErro] = useState('');
  const load = async()=>{ setLoading(true); const d=await DS.getAllCats(); setCats(d??MOCK_CATS); setLoading(false); };
  useEffect(()=>{load();},[]);
  const save = async()=>{
    if(!form.nome) return;
    await DS.upsertCat({nome:form.nome,icone:form.icone,cor:form.cor,ordem:+form.ordem},modal==='new'?null:modal.id);
    setModal(null); load();
  };
  /* FIX (achado REF-ADMIN-01 · Onda 1): DS.delCat agora recusa categoria em uso (ver comentário lá) —
     aqui só reage ao resultado: mensagem clara, sem excluir nada. */
  const excluir = async(c)=>{
    if(!window.confirm('Excluir?')) return;
    setErro('');
    const r = await DS.delCat(c.id);
    if(!r.ok){ setErro(`Não é possível excluir "${c.nome}": ${r.count} produto(s) usam esta categoria.`); return; }
    load();
  };
  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Categorias ({cats.length})</h3>
          <button className="btn-primary" onClick={()=>{setErro('');setForm({nome:'',icone:'🍽️',cor:'#6B21A8',ordem:0});setModal('new');}}>+ Nova</button>
        </div>
        {erro&&<p data-testid="cat-erro" style={{color:'var(--red)',fontSize:13,margin:'0 0 12px'}}>{erro}</p>}
        {loading?<Spinner/>:(
          <table className="data-table">
            <thead><tr><th>Ícone</th><th>Nome</th><th>Ordem</th><th>Ações</th></tr></thead>
            <tbody>{cats.map(c=>(
              <tr key={c.id} data-testid={`cat-row-${c.id}`}>
                <td style={{fontSize:24}}>{c.icone||'🍽️'}</td>
                <td><b>{c.nome}</b></td>
                <td>{c.ordem}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn-sm" onClick={()=>{setForm({nome:c.nome,icone:c.icone||'🍽️',cor:c.cor||'#6B21A8',ordem:c.ordem||0});setModal(c);}}>✏️ Editar</button>
                  <button className="btn-danger" onClick={()=>excluir(c)}>🗑</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {modal&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal-form">
            <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,marginBottom:20}}>{modal==='new'?'Nova Categoria':'Editar Categoria'}</h3>
            <div className="form-group"><label className="form-label">Nome</label>
              <input data-testid="cat-form-nome" className="form-input" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Ícone (emoji)</label>
                <input data-testid="cat-form-icone" className="form-input" value={form.icone} onChange={e=>setForm(f=>({...f,icone:e.target.value}))}/>
              </div>
              <div className="form-group"><label className="form-label">Ordem</label>
                <input data-testid="cat-form-ordem" className="form-input" type="number" value={form.ordem} onChange={e=>setForm(f=>({...f,ordem:+e.target.value}))}/>
              </div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:8}}>
              <button className="btn-secondary" onClick={()=>setModal(null)}>Cancelar</button>
              <button className="btn-primary" onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
