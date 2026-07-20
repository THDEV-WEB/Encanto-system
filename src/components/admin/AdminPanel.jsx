import { useState } from 'react';
import { AdminDashboard } from './AdminDashboard.jsx';
import { AdminPedidos } from './AdminPedidos.jsx';
import { AdminProducts } from './AdminProducts.jsx';
import { AdminCategorias } from './AdminCategorias.jsx';
import { AdminAdicionais } from './AdminAdicionais.jsx';
import { AdminStatus } from './AdminStatus.jsx';
import { AdminDeliveryEta } from './AdminDeliveryEta.jsx';   // REF-DELIVERY-01: config do tempo de entrega
import { AdminFidelidade } from './AdminFidelidade.jsx';
import { AdminHealth } from './AdminHealth.jsx';

export function AdminPanel({ onExit }) {
  const [tab, setTab] = useState('dashboard');
  const tabs = [
    {id:'dashboard', icon:'📊', label:'Dashboard'},
    {id:'pedidos',   icon:'📋', label:'Pedidos'},
    {id:'products',  icon:'🛍️', label:'products'},
    {id:'categorias',icon:'🏷️', label:'Categorias'},
    {id:'adicionais',icon:'➕', label:'Adicionais'},
    {id:'status',    icon:'🏪', label:'Status'},
    {id:'fidelidade',icon:'🎁', label:'Fidelidade'},
    {id:'saude',     icon:'🩺', label:'Saúde'},
  ];
  const titles = {dashboard:'Dashboard',pedidos:'Pedidos',products:'Products',categorias:'Categorias',adicionais:'Adicionais',status:'Status da Loja',fidelidade:'Fidelidade',saude:'Saúde do Sistema'};
  return (
    <div className="admin-layout">
      <div className="admin-sidebar">
        <div className="admin-logo">✨ <span>Encanto</span></div>
        <nav className="admin-nav">
          {tabs.map(t=>(
            <div key={t.id} className={`admin-nav-item ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </nav>
        <div style={{padding:'16px 8px'}}>
          <div className="admin-nav-item" onClick={onExit} style={{color:'rgba(255,255,255,.5)'}}>
            <span className="nav-icon">🚪</span><span>Sair</span>
          </div>
        </div>
      </div>
      <div className="admin-content">
        <div className="admin-top">
          <h1>{titles[tab]}</h1>
          <button className="admin-exit" onClick={onExit}>← Ver loja</button>
        </div>
        <div className="admin-body">
          {tab==='dashboard'  && <AdminDashboard/>}
          {tab==='pedidos'    && <AdminPedidos/>}
          {tab==='products'   && <AdminProducts/>}
          {tab==='categorias' && <AdminCategorias/>}
          {tab==='adicionais' && <AdminAdicionais/>}
          {tab==='status'     && <><AdminStatus/><AdminDeliveryEta/></>}
          {tab==='fidelidade' && <AdminFidelidade/>}
          {tab==='saude'      && <AdminHealth/>}
        </div>
      </div>
    </div>
  );
}
