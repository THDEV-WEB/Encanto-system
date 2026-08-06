/* utils/imageCompression.js — REF-PERF-01.
   Redimensiona/recomprime uma imagem NO NAVEGADOR (Canvas 2D), antes do upload, para o maior tamanho
   que a UI realmente exibe (ImageUploader preview 100%×150px, ProductCard/modal ≤480px de largura —
   ver src/index.css .modal-img/.header-brand-logo). Sem isso, fotos de câmera/celular (2000-4000px,
   1-2MB+) vão inteiras pro Supabase Storage e são baixadas assim por TODO visitante da loja (achado
   da auditoria REF-PERF-01: produtos com imagem de 1,7-2,1MB cada).
   GIF nunca passa por aqui (perderia animação ao redesenhar em canvas) — ver chamador. */

const MAX_DIMENSAO = 1280;  // maior lado, em px — headroom generoso p/ o maior uso real (modal 480px × ~3x DPI)
const QUALIDADE_JPEG = 0.82;

/** Comprime `file` (Blob/File) via canvas; devolve um novo File (mesmo nome, extensão .jpg) ou o
    arquivo ORIGINAL se a compressão falhar ou não render (saída maior/igual à entrada). */
export async function comprimirImagem(file, { maxDimensao = MAX_DIMENSAO, qualidade = QUALIDADE_JPEG } = {}) {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const maiorLado = Math.max(width, height);
    const escala = maiorLado > maxDimensao ? maxDimensao / maiorLado : 1;
    const w = Math.round(width * escala);
    const h = Math.round(height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', qualidade));
    if (!blob || blob.size >= file.size) return file;  // nunca piora o que já veio pequeno/otimizado

    const nomeBase = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${nomeBase}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;   // navegador sem suporte/erro de decodificação — segue com o arquivo original
  }
}
