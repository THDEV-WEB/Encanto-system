import { useState } from 'react';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';   // REF-COMPANY-02: nome curto na sidebar
import { useAdminStore } from '../../hooks/useAdminStore.js';     // REF-SAAS-01 · Onda 5: loja ativa multi-loja
import { AdminDashboard } from './AdminDashboard.jsx';
import { AdminRelatorios } from './AdminRelatorios.jsx'; // REF-DASHBOARD-01: BI de negocio por periodo
import { AdminPedidos } from './AdminPedidos.jsx';
import { AdminProducts } from './AdminProducts.jsx';
import { AdminCategorias } from './AdminCategorias.jsx';
import { AdminAdicionais } from './AdminAdicionais.jsx';
import { AdminStatus } from './AdminStatus.jsx';
import { AdminBusinessHours } from './AdminBusinessHours.jsx'; // REF-BUSINESS-HOURS-04: cronograma semanal administravel
import { AdminDeliveryEta } from './AdminDeliveryEta.jsx';   // REF-DELIVERY-01: config do tempo de entrega
import { AdminTaxaEntrega } from './AdminTaxaEntrega.jsx';   // REF-DELIVERY-FEE-01: taxa de entrega automatica por distancia
import { AdminEmpresa } from './AdminEmpresa.jsx';           // REF-COMPANY-01: dados institucionais da empresa
import { AdminFidelidade } from './AdminFidelidade.jsx';
import { AdminHealth } from './AdminHealth.jsx';
import { AdminMinhaConta } from './AdminMinhaConta.jsx'; // REF-CUSTOMER-01 · Parte 3

export function AdminPanel({ admin, onExit, onLogout }) {
  const companyInfo = useCompanyInfo();
  const { stores, activeStoreId, isSuperAdmin, switchStore } = useAdminStore();
  const [tab, setTab] = useState('dashboard');
  const tabs = [
    {id:'dashboard', icon:'📊', label:'Dashboard'},
    {id:'relatorios',icon:'📈', label:'Relatórios'},
    {id:'pedidos',   icon:'📋', label:'Pedidos'},
    {id:'products',  icon:'🛍️', label:'Produtos'},
    {id:'categorias',icon:'🏷️', label:'Categorias'},
    {id:'adicionais',icon:'➕', label:'Adicionais'},
    {id:'status',    icon:'🏪', label:'Status'},
    {id:'taxaentrega',icon:'🚚', label:'Taxa de Entrega'},
    {id:'empresa',   icon:'🏢', label:'Empresa'},
    {id:'fidelidade',icon:'🎁', label:'Fidelidade'},
    {id:'saude',     icon:'🩺', label:'Saúde'},
    {id:'minhaconta',icon:'👤', label:'Minha Conta'},
  ];
  const titles = {dashboard:'Dashboard',relatorios:'Relatórios',pedidos:'Pedidos',products:'Produtos',categorias:'Categorias',adicionais:'Adicionais',status:'Status da Loja',taxaentrega:'Taxa de Entrega',empresa:'Dados da Empresa',fidelidade:'Fidelidade',saude:'Saúde do Sistema',minhaconta:'Minha Conta'};
  return (
    <div className="admin-layout">
      <div className="admin-sidebar">
        <div className="admin-logo">✨ <span>{companyInfo.nomeCurto}</span></div>
        {/* REF-SAAS-01 · Onda 5: so aparece com MAIS de 1 loja vinculada -- hoje (Cliente Zero, 1
            loja so) nada e renderizado aqui, zero mudanca visual/estrutural pro Admin atual. Trocar
            de loja e so contexto operacional: a RLS/RPC no banco continua sendo quem autoriza de
            verdade, nao esta seleção. */}
        {stores.length > 1 && (
          <div style={{padding:'0 16px 12px'}}>
            <select
              data-testid="admin-store-selector"
              value={activeStoreId || ''}
              onChange={(e) => switchStore(e.target.value)}
              style={{width:'100%', padding:'6px 8px', borderRadius:8, border:'1px solid rgba(255,255,255,.2)', background:'rgba(255,255,255,.08)', color:'#fff'}}
            >
              {stores.map(s => (
                <option key={s.store_id} value={s.store_id} style={{color:'#000'}}>
                  {s.nome}{s.status !== 'ativo' ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
            {isSuperAdmin && <div style={{fontSize:11, opacity:.6, marginTop:4}}>Super admin — todas as lojas</div>}
          </div>
        )}
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
        {/* REF-SAAS-01 · Onda 5: key={activeStoreId} forca remontagem completa ao trocar de loja --
            todo hook das abas ja refaz o fetch inicial no mount, entao a troca de loja atualiza os
            dados automaticamente sem precisar mudar nenhum hook existente. */}
        <div className="admin-body" key={activeStoreId}>
          {tab==='dashboard'  && <AdminDashboard/>}
          {tab==='relatorios' && <AdminRelatorios/>}
          {tab==='pedidos'    && <AdminPedidos/>}
          {tab==='products'   && <AdminProducts/>}
          {tab==='categorias' && <AdminCategorias/>}
          {tab==='adicionais' && <AdminAdicionais/>}
          {tab==='status'     && <><AdminStatus/><AdminBusinessHours/><AdminDeliveryEta/></>}
          {tab==='taxaentrega'&& <AdminTaxaEntrega/>}
          {tab==='empresa'    && <AdminEmpresa/>}
          {tab==='fidelidade' && <AdminFidelidade/>}
          {tab==='saude'      && <AdminHealth/>}
          {tab==='minhaconta' && <AdminMinhaConta admin={admin}/>}
        </div>
      </div>
    </div>
  );
}
