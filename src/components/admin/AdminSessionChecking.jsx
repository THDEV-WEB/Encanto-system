/* components/admin/AdminSessionChecking.jsx — REF-ADMIN-02 · Onda 2.
   Estado intermediário ISOLADO (só existe dentro do gate do useAdminSession): substitui o flash da
   Loja que aparecia enquanto db.auth.getSession() ainda não tinha resolvido, para um navegador que
   já teve uma sessão de Admin guardada. Nunca monta StoreApp/AdminPanel — reutiliza o mesmo Spinner
   já usado no resto do app, só com o wrapper de tela cheia (o Spinner sozinho não centraliza vertical
   por conta própria, pois normalmente vive dentro de um card). */
import { Spinner } from '../ui/Spinner.jsx';

export function AdminSessionChecking() {
  return (
    <div data-testid="admin-session-checking" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner />
    </div>
  );
}
