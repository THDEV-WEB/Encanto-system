/* scripts/optimize-static-images.mjs — REF-PERF-01.
   Reencode ONE-OFF dos assets estáticos (public/) carregados em TODA visita à loja: banner do header,
   logo do header e o selo "V" do rodapé (ValionCredit). Gera .webp ao lado do original (nunca apaga o
   original) redimensionado para o maior tamanho realmente exibido (ver CSS: .header 96-128px de altura,
   .header-brand-logo ≤147px, .valion-v-icon ≤~34px), com headroom de ~3x para telas retina.
   Roda com: node scripts/optimize-static-images.mjs */
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const kb = n => (n / 1024).toFixed(1) + ' KB';

const jobs = [
  // banner do header — background:cover numa faixa de 96-128px de altura, largura = viewport inteiro
  { src: 'header-bg.jpg', out: 'header-bg.webp', maxWidth: 1600, maxHeight: 500, quality: 78, alpha: false },
  // logo do header — exibido a até 147px de altura / 207px de largura (object-fit:contain)
  { src: 'logo.jpg', out: 'logo.webp', maxWidth: 620, maxHeight: 620, quality: 82, alpha: false },
  // selo "V" do rodapé (ValionCredit) — exibido a ~1.55em (~34px de altura), precisa manter transparência
  { src: 'valion-mark.png', out: 'valion-mark.webp', maxWidth: 200, maxHeight: 200, quality: 90, alpha: true },
];

for (const job of jobs) {
  const srcPath = PUBLIC + job.src;
  const outPath = PUBLIC + job.out;
  const before = statSync(srcPath).size;
  const img = sharp(srcPath).resize({ width: job.maxWidth, height: job.maxHeight, fit: 'inside', withoutEnlargement: true });
  await (job.alpha ? img.webp({ quality: job.quality }) : img.webp({ quality: job.quality })).toFile(outPath);
  const after = statSync(outPath).size;
  const pct = (100 * (1 - after / before)).toFixed(0);
  console.log(`${job.src.padEnd(18)} ${kb(before).padStart(10)} -> ${job.out.padEnd(18)} ${kb(after).padStart(10)}  (-${pct}%)`);
}
