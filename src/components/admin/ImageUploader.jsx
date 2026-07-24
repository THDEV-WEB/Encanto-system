import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../lib/supabase.js';
import { DS } from '../../services/DataService.js';
import { isHttpUrl } from '../../utils/catalog.js';

/* ── ImageUploader inline component ─────────────────────────────
   Upload de imagem com Supabase Storage.
   REGRAS:
   - Nunca armazena base64
   - Preserva imagem existente se nenhum novo arquivo for selecionado
   - Fallback visual se image_url for null/inválida
────────────────────────────────────────────────────────────────── */
export function ImageUploader({ currentUrl, onUpload }) {
  const [preview,   setPreview]   = useState(currentUrl || null);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [uploadErr, setUploadErr] = useState('');
  const inputRef = useRef ? useRef(null) : React.useRef(null);

  useEffect(()=>{ setPreview(currentUrl||null); setUploadErr(''); }, [currentUrl]);

  const isValidUrl = isHttpUrl;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validações client-side
    if (file.size > 5*1024*1024) { setUploadErr('Imagem muito grande. Máx. 5 MB.'); return; }
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
      setUploadErr('Formato inválido. Use JPEG, PNG, WebP ou GIF.'); return;
    }
    setUploadErr(''); setUploading(true); setProgress(20);
    // Preview local temporário (só visual — nunca persiste como base64)
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl); setProgress(40);
    try {
      let publicUrl = null;
      if (db) {
        setProgress(55);
        const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
        const name = `products/product_${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;
        const { error: upErr } = await db.storage.from('products').upload(name, file, {
          cacheControl:'3600', upsert:false, contentType:file.type,
        });
        if (upErr) { DS.logEvent('upload','image','error', upErr.message, { ext }); throw new Error(upErr.message); }
        setProgress(80);
        const { data: urlData } = db.storage.from('products').getPublicUrl(name);
        publicUrl = urlData?.publicUrl || null;
        if (!publicUrl) throw new Error('Não foi possível obter URL pública.');
      } else {
        // Offline: usar URL do objeto local como fallback temporário
        // (não persiste no banco — apenas visual no preview)
        console.warn('[ImageUploader] Supabase offline — imagem não será persistida');
        publicUrl = null;
        setUploadErr('Supabase offline — URL não salva. Insira URL manualmente.');
      }
      setProgress(100);
      URL.revokeObjectURL(localUrl);
      if (publicUrl) {
        setPreview(publicUrl);
        onUpload?.(publicUrl);
      } else {
        setPreview(currentUrl||null); // reverter para imagem existente
      }
    } catch(err) {
      console.error('[ImageUploader]', err);
      setUploadErr(err.message || 'Erro no upload.');
      URL.revokeObjectURL(localUrl);
      setPreview(currentUrl||null); // reverter para imagem anterior em caso de erro
    } finally {
      setUploading(false); setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleUrlChange = (e) => {
    const url = e.target.value.trim();
    if (isValidUrl(url)) { setPreview(url); onUpload?.(url); }
    else if (url === '') { setPreview(null); onUpload?.(null); }
  };

  return (
    <div>
      {/* Preview */}
      <div style={{
        position:'relative', width:'100%', height:150, borderRadius:12,
        border:'2px dashed var(--gray-200)', background:'var(--gray-50)',
        overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center',
        marginBottom:10,
      }}>
        {preview && isValidUrl(preview) ? (
          <>
            <img src={preview} alt="Preview" style={{width:'100%',height:'100%',objectFit:'cover'}}
              onError={()=>setPreview(null)}/>
            {!uploading && (
              <button data-testid="img-uploader-remover" onClick={()=>{setPreview(null);onUpload?.(null);}}
                style={{position:'absolute',top:6,right:6,width:24,height:24,borderRadius:6,
                  background:'rgba(220,38,38,.9)',color:'#fff',border:'none',cursor:'pointer',
                  fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--font-body)'}}>
                ✕
              </button>
            )}
          </>
        ) : (
          <div style={{textAlign:'center',color:'var(--gray-400)'}}>
            <div style={{fontSize:32,marginBottom:4}}>🖼️</div>
            <div style={{fontSize:11}}>Sem imagem</div>
          </div>
        )}
        {uploading && (
          <div style={{position:'absolute',bottom:0,left:0,right:0,height:3,background:'var(--gray-200)'}}>
            <div style={{height:'100%',background:'var(--grape)',width:`${progress}%`,transition:'width .3s'}}/>
          </div>
        )}
      </div>

      {/* Botão upload */}
      <input ref={inputRef} data-testid="img-uploader-arquivo" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
        style={{display:'none'}} onChange={handleFile} disabled={uploading}/>
      <button type="button" className="btn-secondary"
        style={{width:'100%',fontSize:13,marginBottom:8}}
        disabled={uploading} onClick={()=>inputRef.current?.click()}>
        {uploading ? `Enviando... ${progress}%` : '📁 Enviar imagem'}
      </button>

      {/* Input URL manual */}
      <label style={{fontSize:11,color:'var(--gray-500)',display:'block',marginBottom:4}}>
        Ou cole uma URL de imagem:
      </label>
      <input data-testid="img-uploader-url" className="form-input" style={{fontSize:13,padding:'8px 12px'}}
        placeholder="https://..." defaultValue={currentUrl||''}
        onChange={handleUrlChange} disabled={uploading}/>

      {uploadErr && (
        <div data-testid="img-uploader-erro" style={{marginTop:6,padding:'7px 10px',borderRadius:8,background:'var(--red-pale)',
          border:'1px solid #FECACA',fontSize:12,color:'var(--red)',fontWeight:600}}>
          ⚠️ {uploadErr}
        </div>
      )}
      <div style={{fontSize:10,color:'var(--gray-400)',marginTop:4}}>
        JPEG · PNG · WebP · GIF — Máx. 5 MB
      </div>
    </div>
  );
}
