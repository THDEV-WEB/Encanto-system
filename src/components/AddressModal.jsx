import React from 'react';

/* ── AddressModal: busca profissional com ViaCEP + Nominatim + Leaflet ── */
export function AddressModal({ onClose, onSelect }) {
  const { useState: us, useEffect: ue, useCallback: ucb, useRef: ur } = React;

  const [tab,         setTab]         = us('search');   // search | cep | map
  const [query,       setQuery]        = us('');
  const [numero,      setNumero]       = us('');
  const [complemento, setComplemento]  = us('');
  const [suggestions, setSuggestions]  = us([]);
  const [status,      setStatus]       = us('idle');    // idle|loading|found|notfound|gps|outrange
  const [cepQuery,    setCepQuery]     = us('');
  const [cepData,     setCepData]      = us(null);
  const [cepNumero,   setCepNumero]    = us('');
  const [mapPin,      setMapPin]       = us({lat:-26.795,lng:-49.270});
  const [mapAddr,     setMapAddr]      = us('');
  const inputRef = ur(null);
  const mapRef   = ur(null);
  const leafRef  = ur(null);

  /* Área de entrega: raio ~15km de Timbó (aproximação por bounding box) */
  const inRange = (lat, lng) => lat>=-27.0&&lat<=-26.5&&lng>=-49.5&&lng>=-49.0;

  ue(()=>{ if(tab==='search') inputRef.current?.focus(); },[tab]);

  /* ── Leaflet: inicializar mapa ao entrar na aba mapa ── */
  ue(()=>{
    if (tab!=='map') return;
    const init = () => {
      if (!window.L || !mapRef.current || leafRef.current) return;
      const map = window.L.map(mapRef.current).setView([mapPin.lat, mapPin.lng], 15);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'© OpenStreetMap'
      }).addTo(map);
      const marker = window.L.marker([mapPin.lat, mapPin.lng],{draggable:true}).addTo(map);
      marker.on('dragend', async e => {
        const {lat,lng} = e.target.getLatLng();
        setMapPin({lat,lng});
        try {
          const r = await fetch(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',
            {headers:{'Accept-Language':'pt-BR'}}
          );
          const d = await r.json();
          const a = d.address||{};
          const addr = [a.road,a.house_number,a.suburb||a.neighbourhood,a.city||a.town]
            .filter(Boolean).join(', ');
          setMapAddr(addr || d.display_name?.split(',').slice(0,3).join(',') || '');
        } catch { setMapAddr(''); }
      });
      map.on('click', async e => {
        const {lat,lng} = e.latlng;
        marker.setLatLng([lat,lng]);
        setMapPin({lat,lng});
        try {
          const r = await fetch(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',
            {headers:{'Accept-Language':'pt-BR'}}
          );
          const d = await r.json();
          const a = d.address||{};
          const addr = [a.road,a.house_number,a.suburb||a.neighbourhood,a.city||a.town]
            .filter(Boolean).join(', ');
          setMapAddr(addr || '');
        } catch { setMapAddr(''); }
      });
      leafRef.current = map;
    };
    if (window.L) { setTimeout(init, 50); return; }
    /* Carregar Leaflet dinamicamente */
    const css = document.createElement('link');
    css.rel='stylesheet'; css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = ()=>setTimeout(init, 50);
    document.head.appendChild(js);
    return ()=>{ if(leafRef.current){leafRef.current.remove();leafRef.current=null;} };
  },[tab]);

  /* ── Busca por CEP via ViaCEP (API brasileira oficial) ── */
  const buscarCEP = ucb(async (cep) => {
    const c = cep.replace(/\D/g,'');
    if (c.length !== 8) return;
    setStatus('loading');
    try {
      const r = await fetch('https://viacep.com.br/ws/'+c+'/json/');
      const d = await r.json();
      if (d.erro) { setStatus('notfound'); setCepData(null); return; }
      setCepData(d);
      setStatus('found');
      setCepNumero('');
    } catch { setStatus('notfound'); setCepData(null); }
  },[]);

  ue(()=>{
    const t = setTimeout(()=>buscarCEP(cepQuery), 400);
    return ()=>clearTimeout(t);
  },[cepQuery, buscarCEP]);

  const confirmCEP = () => {
    if (!cepData || !cepNumero.trim()) { alert('Informe o número da residência.'); return; }
    const short = `${cepData.logradouro}, ${cepNumero.trim()}${complemento?' '+complemento:''} — ${cepData.bairro}`;
    onSelect(short, {
      rua: cepData.logradouro, numero: cepNumero.trim(),
      bairro: cepData.bairro, cidade: cepData.localidade,
      estado: cepData.uf, cep: cepData.cep,
      complemento: complemento,
    });
  };

  /* ── Busca por rua/nome via Nominatim multi-estratégia ── */
  const searchAddress = ucb(async (q) => {
    if (!q || q.length < 3) { setSuggestions([]); setStatus('idle'); return; }
    setStatus('loading');
    const NOM = 'https://nominatim.openstreetmap.org/search';
    const H   = {'Accept-Language':'pt-BR'};
    const numM  = q.match(/(\d+)/);
    const num   = numM ? numM[1] : '';
    const semN  = q.replace(/\d+/g,'').replace(/[-,]/g,' ').trim();
    const urls  = [
      NOM+'?format=json&q='+encodeURIComponent(q+', Timbó, SC, Brasil')+'&limit=6&addressdetails=1&countrycodes=br',
      num && semN.length>2
        ? NOM+'?format=json&street='+encodeURIComponent(num+' '+semN)+'&city=Timb%C3%B3&state=Santa+Catarina&country=Brasil&format=json&addressdetails=1&limit=5'
        : null,
      semN.length>3
        ? NOM+'?format=json&q='+encodeURIComponent(semN+', Timbó, SC')+'&limit=5&addressdetails=1&countrycodes=br'
        : null,
    ].filter(Boolean);
    try {
      let res=[];
      for(const u of urls){ if(res.length>0)break; const r=await fetch(u,{headers:H}); const d=await r.json(); res=Array.isArray(d)?d:[]; }
      const seen=new Set();
      res=res.filter(s=>{ const k=(s.address?.road||'')+','+(s.address?.house_number||''); if(seen.has(k))return false; seen.add(k);return true; });
      if(res.length>0){setSuggestions(res);setStatus('found');}
      else{setSuggestions([]);setStatus('notfound');}
    } catch { setSuggestions([]); setStatus('notfound'); }
  },[]);

  ue(()=>{ const t=setTimeout(()=>searchAddress(query),450); return()=>clearTimeout(t); },[query,searchAddress]);

  /* ── GPS ── */
  const useGPS = () => {
    if(!navigator.geolocation){alert('GPS indisponível.');return;}
    setStatus('gps');
    navigator.geolocation.getCurrentPosition(async pos=>{
      const {latitude:lat,longitude:lng}=pos.coords;
      try {
        const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',{headers:{'Accept-Language':'pt-BR'}});
        const d=await r.json(); const a=d.address||{};
        const short=[a.road,a.house_number].filter(Boolean).join(', ')||d.display_name?.split(',')[0]||'';
        const bairro=a.suburb||a.neighbourhood||''; const cidade=a.city||a.town||'Timbó';
        onSelect(short+( bairro?' — '+bairro:''), {lat,lng,rua:a.road||'',numero:a.house_number||'',bairro,cidade,estado:a.state||'SC',cep:a.postcode||''});
      } catch { onSelect(lat.toFixed(5)+', '+lng.toFixed(5),{lat,lng}); }
    },()=>{ setStatus('idle'); alert('Não foi possível obter a localização.'); });
  };

  /* ── Selecionar sugestão ── */
  const pick = (s) => {
    const a=s.address||{};
    const rua=a.road||''; const num=a.house_number||''; const bairro=a.suburb||a.neighbourhood||a.quarter||'';
    const cidade=a.city||a.town||a.municipality||'Timbó'; const cep=a.postcode||''; const estado=a.state||'SC';
    const short=[rua+( num?', '+num:''), bairro].filter(Boolean).join(' — ') || s.display_name.split(',').slice(0,2).join(',').trim();
    onSelect(short, {lat:parseFloat(s.lat),lng:parseFloat(s.lon),rua,numero:num,bairro,cidade,estado,cep,full:s.display_name});
  };

  /* ── Confirmar pelo mapa ── */
  const confirmMap = async () => {
    if(!mapAddr.trim()&&!cepNumero.trim()){
      const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+mapPin.lat+'&lon='+mapPin.lng+'&addressdetails=1',{headers:{'Accept-Language':'pt-BR'}});
      const d=await r.json(); const a=d.address||{};
      const addr=[a.road,a.house_number,a.suburb,a.city||a.town].filter(Boolean).join(', ');
      onSelect(addr||'Localização no mapa',{lat:mapPin.lat,lng:mapPin.lng});
    } else {
      onSelect(mapAddr||('Lat '+mapPin.lat.toFixed(5)),{lat:mapPin.lat,lng:mapPin.lng});
    }
  };

  /* ── UI ── */
  const TABS=[{id:'search',label:'🔍 Buscar endereço'},{id:'cep',label:'📮 Buscar por CEP'},{id:'map',label:'🗺️ Ver no mapa'}];

  return (
    <div className="addr-modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="addr-modal" style={{maxWidth:500}}>

        {/* Header */}
        <div className="addr-modal-head">
          <span className="addr-modal-title">📍 Onde receber seu pedido?</span>
          <button className="addr-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Abas */}
        <div style={{display:'flex',borderBottom:'1px solid var(--gray-100)',background:'var(--gray-50)'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flex:1,padding:'10px 4px',border:'none',background:'none',cursor:'pointer',
              fontSize:11,fontWeight:700,fontFamily:'var(--font-body)',
              borderBottom: tab===t.id ? '2px solid var(--grape)' : '2px solid transparent',
              color: tab===t.id ? 'var(--grape)' : 'var(--gray-500)',
              transition:'all .15s',
            }}>{t.label}</button>
          ))}
        </div>

        <div className="addr-modal-body">

          {/* ── ABA: Buscar por nome/rua ── */}
          {tab==='search' && (
            <>
              <input ref={inputRef} className="addr-search-input"
                placeholder="Rua, número, bairro ou local..." value={query}
                onChange={e=>setQuery(e.target.value)}/>
              <button className="addr-gps-btn" onClick={useGPS}>
                {status==='gps'
                  ? <><span style={{display:'inline-block',animation:'spin .8s linear infinite'}}>⏳</span> Obtendo localização...</>
                  : <><span>🎯</span> Usar minha localização atual</>}
              </button>
              {status==='loading' && (
                <div style={{textAlign:'center',padding:'20px',color:'var(--gray-400)'}}>
                  <div className="spinner" style={{margin:'0 auto 8px'}}/><p style={{fontSize:13}}>Buscando...</p>
                </div>
              )}
              {status==='found' && (
                <div className="addr-suggestions" style={{marginTop:10}}>
                  {suggestions.map((s,i)=>{
                    const a=s.address||{};
                    const main=[a.road,a.house_number].filter(Boolean).join(', ')||s.display_name.split(',')[0];
                    const sub=[a.suburb||a.neighbourhood,a.city||a.town,a.postcode?'CEP '+a.postcode:''].filter(Boolean).join(' · ');
                    return (
                      <div key={i} className="addr-suggestion-item" onClick={()=>pick(s)}>
                        <span className="addr-suggestion-icon">📍</span>
                        <div className="addr-suggestion-text">
                          <div className="addr-suggestion-main">{main}</div>
                          {sub&&<div className="addr-suggestion-sub">{sub}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {status==='notfound' && (
                <div className="addr-not-found">
                  <div style={{fontSize:28,marginBottom:6}}>🔍</div>
                  <p><b>Endereço não encontrado.</b><br/>Tente buscar pelo CEP ou marque no mapa.</p>
                  <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',marginTop:10}}>
                    <button className="addr-map-btn" onClick={()=>setTab('cep')}>📮 Buscar por CEP</button>
                    <button className="addr-map-btn" onClick={()=>setTab('map')}>🗺️ Ver no mapa</button>
                  </div>
                </div>
              )}
              {status==='idle' && !query && (
                <div style={{marginTop:12}}>
                  <div className="addr-section-label">Dicas de busca</div>
                  <div style={{fontSize:12,color:'var(--gray-500)',lineHeight:1.8,padding:'4px 0'}}>
                    • Ex: <b>Rua das Flores, 123</b><br/>
                    • Ex: <b>João Schlay 77</b><br/>
                    • Ex: <b>Testo Central, Timbó</b>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── ABA: Buscar por CEP ── */}
          {tab==='cep' && (
            <>
              <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:6}}>
                CEP
              </label>
              <input className="addr-search-input"
                placeholder="00000-000"
                value={cepQuery}
                maxLength={9}
                onChange={e=>{
                  let v=e.target.value.replace(/\D/g,'');
                  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5,8);
                  setCepQuery(v); setStatus('idle'); setCepData(null);
                }}/>
              {status==='loading' && (
                <div style={{textAlign:'center',padding:'16px',color:'var(--gray-400)'}}>
                  <div className="spinner" style={{margin:'0 auto 8px'}}/><p style={{fontSize:13}}>Buscando CEP...</p>
                </div>
              )}
              {status==='found' && cepData && (
                <div style={{marginTop:12}}>
                  <div style={{
                    background:'var(--grape-pale)',borderRadius:10,padding:'12px 14px',
                    border:'1px solid #DDD6FE',marginBottom:12,
                  }}>
                    <div style={{fontWeight:700,fontSize:14,color:'var(--amarelo)',marginBottom:4}}>
                      ✅ CEP encontrado
                    </div>
                    <div style={{fontSize:13,color:'var(--gray-700)',lineHeight:1.7}}>
                      <b>{cepData.logradouro}</b><br/>
                      {cepData.bairro} · {cepData.localidade}/{cepData.uf}
                    </div>
                  </div>
                  <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:4}}>
                    Número da residência <span style={{color:'var(--orange)'}}>*</span>
                  </label>
                  <input className="addr-search-input" style={{marginBottom:8}}
                    placeholder="Ex: 77" value={cepNumero}
                    onChange={e=>setCepNumero(e.target.value)}/>
                  <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:4}}>
                    Complemento (opcional)
                  </label>
                  <input className="addr-search-input" style={{marginBottom:12}}
                    placeholder="Ex: Casa 02, Ap 301" value={complemento}
                    onChange={e=>setComplemento(e.target.value)}/>
                  <button className="addr-confirm-btn" onClick={confirmCEP}>
                    ✅ Confirmar endereço
                  </button>
                </div>
              )}
              {status==='notfound' && (
                <div className="addr-not-found" style={{marginTop:16}}>
                  <p>CEP não encontrado. Verifique e tente novamente.</p>
                </div>
              )}
            </>
          )}

          {/* ── ABA: Mapa Leaflet interativo ── */}
          {tab==='map' && (
            <>
              <p style={{fontSize:12,color:'var(--gray-500)',marginBottom:8,lineHeight:1.5}}>
                Clique ou arraste o marcador para marcar seu endereço.
              </p>
              <div className="addr-map-container" style={{height:300}}>
                <div ref={mapRef} style={{width:'100%',height:'100%'}}/>
              </div>
              {mapAddr && (
                <div style={{
                  marginTop:8,padding:'8px 12px',background:'var(--grape-pale)',
                  borderRadius:8,fontSize:13,color:'var(--amarelo)',fontWeight:600,
                }}>
                  📍 {mapAddr}
                </div>
              )}
              <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',margin:'10px 0 4px'}}>
                Número da residência
              </label>
              <input className="addr-search-input" style={{marginBottom:10}}
                placeholder="Ex: 77" value={cepNumero}
                onChange={e=>setCepNumero(e.target.value)}/>
              <button className="addr-confirm-btn" onClick={confirmMap}>
                ✅ Confirmar localização no mapa
              </button>
              <p style={{fontSize:10,color:'var(--gray-400)',textAlign:'center',marginTop:6}}>
                Lat: {mapPin.lat.toFixed(5)} · Lng: {mapPin.lng.toFixed(5)}
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
