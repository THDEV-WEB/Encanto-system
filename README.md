# encanto-react

[![CI](https://github.com/THDEV-WEB/Encanto-system/actions/workflows/ci.yml/badge.svg)](https://github.com/THDEV-WEB/Encanto-system/actions/workflows/ci.yml)

Migração do sistema **Encanto – Açaí & Marmitas** para **Vite + React**, mantendo o
sistema original intocado em `../Encanto/`.

> **Estado atual:** *port* fiel do monólito. A lógica de negócio (Supabase,
> categorias, carrinho, painel admin, etc.) é **idêntica** à do sistema atual —
> apenas foi movida para um projeto com build real (sem Babel no browser).
> A divisão em `components/`, `hooks/` e `services/` é uma fase **futura**.

## Pré-requisito: Node.js

Esta máquina **não tem Node/npm instalados**. Instale o **Node.js LTS** (inclui o npm):
https://nodejs.org/  — ou via winget:

```powershell
winget install OpenJS.NodeJS.LTS
```

Feche e reabra o terminal depois de instalar (para o PATH atualizar).

## Rodar

```powershell
cd "c:\Users\00thi\OneDrive\Projetos\Encanto\encanto-react"
npm install      # instala react, react-dom, @supabase/supabase-js, vite
npm run dev      # sobe o servidor de desenvolvimento (http://localhost:5173)
```

Build de produção:

```powershell
npm run build    # gera a pasta dist/
npm run preview  # serve o build localmente para conferência
```

## Estrutura

```
encanto-react/
  index.html          # shell do Vite (head/fonts + <div id="root"> + main.jsx)
  vite.config.js      # plugin React
  .env                # VITE_SUPABASE_URL / VITE_SUPABASE_KEY / VITE_WHATSAPP
  .env.example        # modelo sem segredos
  src/
    main.jsx          # ReactDOM.createRoot(...).render(<App/>)
    App.jsx           # APP INTEIRO (port verbatim do monólito)
    index.css         # ~1100 linhas de CSS extraídas do <style> original
    logo.js           # logo em base64 (export const ENCANTO_LOGO)
```

## O que mudou em relação ao monólito (apenas plumbing, não lógica)

- React/ReactDOM/Supabase agora vêm do **npm**, não de CDN.
- JSX é compilado pelo **Vite** (build), não pelo Babel standalone no navegador.
- Chaves do Supabase saíram do código para **variáveis de ambiente** (`.env`).
- O bloco de debug `testSupabaseProducts()` (que o autor já marcara para remoção)
  não foi portado. Todo o resto é igual.

## Próximas fases (não feitas ainda)

1. Quebrar `App.jsx` em `services/` (DS/Supabase), `hooks/` (useCart, useProducts…)
   e `components/` (loja + admin), um arquivo por vez, validando com `npm run dev`.
2. Revisar o bug conhecido das duas colunas de imagem (`imagem_url` x `image_url`).
