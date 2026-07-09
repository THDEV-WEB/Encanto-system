import { useState, useEffect } from 'react';
import { DS } from '../../services/DataService.js';
import { MOCK_ADS } from '../../utils/addons.js';
import { fmt } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';

export function AdminAdicionais() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({nome:'',preco:''});
  const load = async()=>{ setLoading(true); const d=await DS.getAllAds(); setItems(d??MOCK_ADS); setLoading(false); };
  useEffect(()=>{load();},[]);
  const save = async()=>{
    if(!form.nome) return;
    await DS.upsertAd({nome:form.nome,preco:+form.preco||0},modal==='new'?null:modal.id);
    setModal(null); load();
  };
  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Adicionais ({items.length})</h3>
          <button className="btn-primary" onClick={()=>{setForm({nome:'',preco:''});setModal('new');}}>+ Novo</button>
        </div>
        {loading?<Spinner/>:(
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Grupo</th><th>Tipo</th><th>Preço</th><th>Ações</th></tr></thead>
            <tbody>{items.map(it=>(
              <tr key={it.id}>
                <td style={{fontWeight:600}}>{it.nome}</td>
                <td><span className="badge badge-purple" style={{fontSize:10}}>
                  {it.grupo==='marmita'?'🍱 Marmita':it.grupo==='bebida'?'🧃 Bebida':'🍇 Açaí'}</span></td>
                <td><span className={`badge ${it.tipo==='pago'?'badge-orange':'badge-green'}`}>
                  {it.tipo==='pago'?'Pago':'Grátis'}</span></td>
                <td>{it.tipo==='pago'?fmt(it.preco):'—'}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn-sm" onClick={()=>{setForm({nome:it.nome,preco:it.preco,tipo:it.tipo||'gratis',grupo:it.grupo||'acai'});setModal(it);}}>✏️</button>
                  <button className="btn-danger" onClick={async()=>{if(window.confirm('Excluir?')){await DS.delAd(it.id);load();}}}>🗑</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {modal&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal-form">
            <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,marginBottom:20}}>{modal==='new'?'Novo Adicional':'Editar Adicional'}</h3>
            <div className="form-group"><label className="form-label">Nome</label>
              <input className="form-input" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/>
            </div>
            <div className="form-group"><label className="form-label">Tipo</label>
              <select className="form-select" value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}>
                <option value="gratis">Grátis (incluso no produto)</option>
                <option value="pago">Pago (cobrado à parte)</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Grupo (categoria)</label>
              <select className="form-select" value={form.grupo||'acai'} onChange={e=>setForm(f=>({...f,grupo:e.target.value}))}>
                <option value="acai">🍇 Adicionais Açaí</option>
                <option value="marmita">🍱 Adicionais Marmita</option>
                <option value="bebida">🧃 Adicionais Bebida</option>
              </select>
            </div>
            {form.tipo==='pago' && (
              <div className="form-group"><label className="form-label">Preço (R$)</label>
                <input className="form-input" type="number" step="0.01" value={form.preco} onChange={e=>setForm(f=>({...f,preco:e.target.value}))}/>
              </div>
            )}
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
