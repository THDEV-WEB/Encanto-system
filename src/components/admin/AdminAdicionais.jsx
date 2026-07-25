import { useState, useEffect } from 'react';
import { DS } from '../../services/DataService.js';
import { MOCK_ADS, GRUPOS } from '../../utils/addons.js';
import { grupoLabel } from '../../utils/addonGroupLabels.js';
import { fmt } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';

/* FIX (achado REF-REGRESSION-01 · P6): rótulo/emoji são UI (addons.js não fabrica isso, é dado
   cru) — fonte única agora é utils/addonGroupLabels.js (grupoLabel), NÃO mais um mapa local aqui.
   Antes, tanto o <select> de edição quanto o badge da listagem só conheciam 3 dos 7 grupos REAIS
   da tabela (acai/marmita/bebida) — as outras 4 linhas (simples/premium/frutas_premium/chocolates,
   usadas de propósito pelo "Monte seu Copo" seccionado) caíam no fallback "🍇 Açaí" do badge
   (reforçando a falsa impressão de duplicidade) e, pior, o <select> de edição não tinha OPTION
   correspondente — salvar sem mexer no campo reescrevia o grupo de uma dessas linhas por engano,
   corrompendo o modelo seccionado de verdade. */

export function AdminAdicionais() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({nome:'',preco:'',tipo:'gratis',grupo:GRUPOS.ACAI});
  const [erroExclusao, setErroExclusao] = useState('');
  const load = async()=>{ setLoading(true); const d=await DS.getAllAds(); setItems(d??MOCK_ADS); setLoading(false); };
  useEffect(()=>{load();},[]);
  const save = async()=>{
    if(!form.nome) return;
    /* FIX (achado REF-E2E-03): tipo/grupo eram capturados no form mas nunca enviados ao upsertAd —
       "Novo Adicional" sempre falhava (adicionais.grupo é NOT NULL sem default) e editar o Tipo/
       Grupo de um adicional existente era silenciosamente ignorado (o UPDATE nunca tocava essas
       colunas). */
    await DS.upsertAd({nome:form.nome,tipo:form.tipo||'gratis',grupo:form.grupo||GRUPOS.ACAI,preco:+form.preco||0},modal==='new'?null:modal.id);
    setModal(null); load();
  };
  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Adicionais ({items.length})</h3>
          <button className="btn-primary" onClick={()=>{setForm({nome:'',preco:'',tipo:'gratis',grupo:GRUPOS.ACAI});setModal('new');}}>+ Novo</button>
        </div>
        {erroExclusao && <p style={{color:'var(--red)',fontSize:13,padding:'0 16px 8px'}}>{erroExclusao}</p>}
        {loading?<Spinner/>:(
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Grupo</th><th>Tipo</th><th>Preço</th><th>Ações</th></tr></thead>
            <tbody>{items.map(it=>(
              <tr key={it.id} data-testid={`ad-row-${it.id}`}>
                <td style={{fontWeight:600}}>{it.nome}</td>
                <td><span className="badge badge-purple" style={{fontSize:10}}>
                  {grupoLabel(it.grupo)}</span></td>
                <td><span className={`badge ${it.tipo==='pago'?'badge-orange':'badge-green'}`}>
                  {it.tipo==='pago'?'Pago':'Grátis'}</span></td>
                <td>{it.tipo==='pago'?fmt(it.preco):'—'}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn-sm" onClick={()=>{setForm({nome:it.nome,preco:it.preco,tipo:it.tipo||'gratis',grupo:it.grupo||GRUPOS.ACAI});setModal(it);}}>✏️</button>
                  <button className="btn-danger" onClick={async()=>{
                    if(!window.confirm('Excluir?')) return;
                    setErroExclusao('');
                    const r = await DS.delAd(it.id);
                    if (!r.ok) setErroExclusao(`Não foi possível excluir "${it.nome}": ${r.error || 'erro desconhecido'}.`);
                    load();
                  }}>🗑</button>
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
              <input data-testid="ad-form-nome" className="form-input" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/>
            </div>
            <div className="form-group"><label className="form-label">Tipo</label>
              <select data-testid="ad-form-tipo" className="form-select" value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}>
                <option value="gratis">Grátis (incluso no produto)</option>
                <option value="pago">Pago (cobrado à parte)</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Grupo (categoria)</label>
              <select data-testid="ad-form-grupo" className="form-select" value={form.grupo||GRUPOS.ACAI} onChange={e=>setForm(f=>({...f,grupo:e.target.value}))}>
                {Object.values(GRUPOS).map(g => <option key={g} value={g}>{grupoLabel(g)}</option>)}
              </select>
            </div>
            {form.tipo==='pago' && (
              <div className="form-group"><label className="form-label">Preço (R$)</label>
                <input data-testid="ad-form-preco" className="form-input" type="number" step="0.01" value={form.preco} onChange={e=>setForm(f=>({...f,preco:e.target.value}))}/>
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
