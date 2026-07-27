import { useState } from 'react';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';   // REF-COMPANY-02: nome curto na sidebar
import { AdminDashboard } from './AdminDashboard.jsx';
import { AdminPedidos } from './AdminPedidos.jsx';
import { AdminProducts } from './AdminProducts.jsx';
import { AdminCategorias } from './AdminCategorias.jsx';
import { AdminAdicionais } from './AdminAdicionais.jsx';
import { AdminStatus } from './AdminStatus.jsx';
import { AdminDeliveryEta } from './AdminDeliveryEta.jsx';   // REF-DELIVERY-01: config do tempo de entrega
import { AdminEmpresa } from './AdminEmpresa.jsx';           // REF-COMPANY-01: dados institucionais da empresa
import { AdminFidelidade } from './AdminFidelidade.jsx';
import { AdminHealth } from './AdminHealth.jsx';
import { AdminMinhaConta } from './AdminMinhaConta.jsx'; // REF-CUSTOMER-01 · Parte 3

export function AdminPanel({ admin, onExit, onLogout }) {
  const companyInfo = useCompanyInfo();
  const [tab, setTab] = useState('dashboard');
  const tabs = [
    {id:'dashboard', icon:'📊', label:'Dashboard'},
    {id:'pedidos',   icon:'📋', label:'Pedidos'},
    {id:'products',  icon:'🛍️', label:'Produtos'},
    {id:'categorias',icon:'🏷️', label:'Categorias'},
    {id:'adicionais',icon:'➕', label:'Adicionais'},
    {id:'status',    icon:'🏪', label:'Status'},
    {id:'empresa',   icon:'🏢', label:'Empresa'},
    {id:'fidelidade',icon:'🎁', label:'Fidelidade'},
    {id:'saude',     icon:'🩺', label:'Saúde'},
    {id:'minhaconta',icon:'👤', label:'Minha Conta'},
  ];
  const titles = {dashboard:'Dashboard',pedidos:'Pedidos',products:'Produtos',categorias:'Categorias',adicionais:'Adicionais',status:'Status da Loja',empresa:'Dados da Empresa',fidelidade:'Fidelidade',saude:'Saúde do Sistema',minhaconta:'Minha Conta'};
  return (
    <div className="admin-layout">
      <div className="admin-sidebar">
        <div className="admin-logo">✨ <span>{companyInfo.nomeCurto}</span></div>
        <nav className="admin-nav">
          {tabs.map(t=>(
            <div key={t.id} data-testid={`admin-tab-${t.id}`} className={`admin-nav-item ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </nav>
        <div style={{padding:'16px 8px'}}>
          <div className="admin-nav-item" data-testid="admin-logout" onClick={onLogout} style={{color:'rgba(255,255,255,.5)'}}>
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
          {tab==='empresa'    && <AdminEmpresa/>}
          {tab==='fidelidade' && <AdminFidelidade/>}
          {tab==='saude'      && <AdminHealth/>}
          {tab==='minhaconta' && <AdminMinhaConta admin={admin}/>}
        </div>
      </div>
    </div>
  );
}
