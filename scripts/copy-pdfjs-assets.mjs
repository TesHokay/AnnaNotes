// Copies pdf.js CMaps and standard fonts into public/ so PDFs with non-embedded or CJK fonts
// render offline. Runs automatically after `npm install` (postinstall).
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist';
if (!existsSync(src)) {
  console.warn('pdfjs-dist not installed yet, skipping asset copy');
  process.exit(0);
}
mkdirSync('public/pdfjs', { recursive: true });
cpSync(`${src}/cmaps`, 'public/pdfjs/cmaps', { recursive: true });
cpSync(`${src}/standard_fonts`, 'public/pdfjs/standard_fonts', { recursive: true });
console.log('pdf.js cmaps and standard fonts copied to public/pdfjs');
