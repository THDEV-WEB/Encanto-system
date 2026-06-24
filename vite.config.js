import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Config mínima — apenas o plugin React (JSX). Nada de mágica adicional
// para manter o comportamento o mais próximo possível do sistema atual.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
