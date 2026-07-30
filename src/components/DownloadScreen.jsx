/* components/DownloadScreen.jsx — REF-CAP-01 · Onda 7 (Distribuição).
   Página standalone (fora da árvore Loja/Admin) servida em /encanto/download — ver hooks/useDownloadPage.js
   pro roteamento e vercel.json pro rewrite que faz esse path carregar o bundle. Link de download aponta
   pro caminho físico onde o APK deve ser colocado manualmente (ver nota abaixo) — sem pipeline de
   atualização automática de APK nesta REF, por pedido explícito. */
const APK_PATH = `${import.meta.env.BASE_URL}downloads/Encanto.apk`;

export function DownloadScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--gray-50)' }}>
      <div style={{ maxWidth: 440, width: '100%', background: '#fff', borderRadius: 20, padding: '40px 32px', boxShadow: '0 12px 40px -12px rgba(44,34,25,.18)', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>📦</div>
        <h1 style={{ fontFamily: 'var(--font-body)', fontWeight: 800, color: 'var(--grape)', fontSize: 24, margin: '0 0 8px' }}>
          Baixe o app do Encanto
        </h1>
        <p style={{ color: 'var(--gray-600)', fontSize: 14.5, lineHeight: 1.6, margin: '0 0 24px' }}>
          Aplicativo Android nativo — mesma loja, mesmo cardápio, mesmo login. Instalação direta, fora da
          Play Store.
        </p>

        <a
          href={APK_PATH}
          download
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px 20px', borderRadius: 12, background: 'var(--grape)', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
        >
          ⬇️ Baixar aplicativo Android
        </a>

        <p style={{ color: 'var(--gray-500)', fontSize: 12.5, margin: '16px 0 0', lineHeight: 1.6 }}>
          Requer Android 7.0 ou superior. Como o app não vem da Play Store, o Android pode pedir
          confirmação para instalar de "fontes desconhecidas" — isso é normal para apps distribuídos
          diretamente.
        </p>

        <a href={import.meta.env.BASE_URL} style={{ display: 'inline-block', marginTop: 24, color: 'var(--grape)', fontSize: 13.5, fontWeight: 600, textDecoration: 'underline' }}>
          ← Voltar para o site
        </a>
      </div>
    </div>
  );
}
