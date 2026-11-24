import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const htmlFiles = readdirSync(root, { recursive: true })
  .filter((file) => typeof file === 'string' && file.endsWith('.html') && !file.startsWith('.git'))
  .sort();
const publicFiles = htmlFiles.filter((file) => file !== '404.html' && !file.startsWith('google'));
const canonicalByFile = new Map();
const titles = new Map();
const canonicals = new Map();
const cssVersions = new Set();

const read = (file) => readFileSync(join(root, file), 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? null;
const pagePath = (file) => file === 'index.html' ? '/' : `/${file.replace(/\\/g, '/').replace(/index\.html$/, '')}`;

for (const file of publicFiles) {
  const source = read(file);
  const title = source.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const description = source.match(/<meta name="description" content="([^"]+)"/i)?.[1]?.trim();
  const canonical = source.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];

  assert.ok(title, `${file}: título ausente.`);
  assert.ok(title.length <= 75, `${file}: título muito longo (${title.length} caracteres).`);
  assert.ok(description, `${file}: descrição ausente.`);
  assert.ok(description.length >= 50 && description.length <= 180, `${file}: descrição fora do intervalo recomendado (${description.length} caracteres).`);
  assert.doesNotMatch(source, /<meta\s+name="robots"\s+content="[^"]*noindex/i, `${file}: página pública marcada como noindex.`);
  assert.equal(canonical, `https://infotech-io.com.br${pagePath(file)}`, `${file}: URL canônica incorreta.`);
  assert.ok(!titles.has(title), `${file}: título duplicado com ${titles.get(title)}.`);
  assert.ok(!canonicals.has(canonical), `${file}: URL canônica duplicada com ${canonicals.get(canonical)}.`);
  titles.set(title, file);
  canonicals.set(canonical, file);
  canonicalByFile.set(file, canonical);

  assert.match(source, /<meta property="og:title" content="[^"]+"/i, `${file}: og:title ausente.`);
  assert.match(source, /<meta property="og:description" content="[^"]+"/i, `${file}: og:description ausente.`);
  assert.match(source, /<meta property="og:image" content="https:\/\/infotech-io\.com\.br\/[^"]+"/i, `${file}: og:image ausente ou externa.`);
  assert.match(source, /<meta property="og:url" content="https:\/\/infotech-io\.com\.br\/[^"]*"/i, `${file}: og:url ausente.`);

  const ids = [...source.matchAll(/\bid="([^"]+)"/gi)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, `${file}: existem IDs duplicados.`);

  const headings = [...source.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  assert.equal(headings[0], 1, `${file}: a primeira hierarquia deve ser H1.`);
  for (let index = 1; index < headings.length; index += 1) {
    assert.ok(headings[index] <= headings[index - 1] + 1, `${file}: salto de H${headings[index - 1]} para H${headings[index]}.`);
  }

  for (const match of source.matchAll(/<button\b[^>]*>/gi)) {
    assert.match(match[0], /\btype="(?:button|submit|reset)"/i, `${file}: botão sem tipo explícito: ${match[0]}`);
  }

  for (const match of source.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)) {
    const tag = match[0];
    if (attr(tag, 'type') === 'hidden') continue;
    const id = attr(tag, 'id');
    const beforeField = source.slice(0, match.index);
    const wrappedByLabel = beforeField.lastIndexOf('<label') > beforeField.lastIndexOf('</label>');
    const labelled = attr(tag, 'aria-label') || attr(tag, 'aria-labelledby') || wrappedByLabel || (id && new RegExp(`<label\\b[^>]*for="${id}"`, 'i').test(source));
    assert.ok(labelled, `${file}: campo sem rótulo acessível: ${tag}`);
  }

  for (const match of source.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) {
    assert.match(match[0], /\brel="[^"]*noopener[^"]*"/i, `${file}: link externo sem noopener.`);
  }

  for (const match of source.matchAll(/(?:href|src)="([^"]+)"/gi)) {
    const value = match[1];
    assert.ok(!value.startsWith('http://'), `${file}: recurso inseguro: ${value}`);
    if (!value.startsWith('/') || value.startsWith('//')) continue;
    const [urlPath, fragment] = value.split('#');
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    let target = join(root, decoded.slice(1));
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    assert.ok(existsSync(target), `${file}: destino local ausente: ${value}`);
    if (fragment && target.endsWith('.html')) {
      assert.match(readFileSync(target, 'utf8'), new RegExp(`\\bid="${fragment}"`), `${file}: fragmento ausente em ${value}.`);
    }
  }

  for (const block of source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) JSON.parse(block[1]);
  for (const version of source.matchAll(/site\.css\?v=([0-9.]+)/g)) cssVersions.add(version[1]);
}

assert.equal(cssVersions.size, 1, `Versões de CSS inconsistentes: ${[...cssVersions].join(', ')}`);

const sitemap = read('sitemap.xml');
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
assert.deepEqual(sitemapUrls, new Set(canonicalByFile.values()), 'O sitemap deve listar exatamente todas as páginas públicas.');
const lastModifiedDates = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)];
assert.equal(lastModifiedDates.length, sitemapUrls.size, 'Cada URL do sitemap deve informar a data de modificação.');
for (const match of lastModifiedDates) {
  assert.match(match[1], /^\d{4}-\d{2}-\d{2}$/, `Data inválida no sitemap: ${match[1]}`);
}

const projects = JSON.parse(read('projects.json'));
assert.equal(projects.length, new Set(projects.map((project) => project.id)).size, 'projects.json possui IDs duplicados.');
for (const project of projects) {
  assert.ok(project.id && project.name && project.category && project.status, `Projeto incompleto: ${JSON.stringify(project)}`);
  assert.ok(existsSync(join(root, 'projetos', project.id, 'index.html')), `Página ausente para o projeto ${project.id}.`);
  if (project.demo) assert.match(project.demo, /^https:\/\//, `Demo insegura no projeto ${project.id}.`);
}

assert.equal(read('CNAME').trim(), 'infotech-io.com.br', 'CNAME incorreto.');
assert.match(read('robots.txt'), /Sitemap: https:\/\/infotech-io\.com\.br\/sitemap\.xml/);
assert.ok(existsSync(join(root, '.nojekyll')), '.nojekyll ausente.');

const css = read('assets/site.css');
assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, 'CSS possui chaves desbalanceadas.');
assert.ok(statSync(join(root, 'assets/site.js')).size < 15_000, 'JavaScript principal cresceu além do limite leve do projeto.');

console.log(`Auditoria completa: OK (${publicFiles.length} páginas, ${projects.length} projetos).`);
