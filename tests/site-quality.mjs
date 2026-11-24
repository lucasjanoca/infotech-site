import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const htmlFiles = readdirSync(root, { recursive: true })
  .filter((file) => typeof file === 'string' && file.endsWith('.html') && !file.startsWith('.git'));
const projectData = readFileSync(join(root, 'projects.json'), 'utf8');
const projects = JSON.parse(projectData);
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const retiredReferences = [
  'lucasjanoca/stoski2026',
  'lucasjanoca/Italo-eFootball',
  'lucasjanoca/Sistema-De-Est-tica-',
  'lucasjanoca/InfoTech.io',
  'lucasjanoca/plexo-pesquisa-pre-lancamento',
];

for (const retired of retiredReferences) {
  assert.ok(!projectData.includes(retired), `projects.json ainda usa o nome antigo: ${retired}`);
  assert.ok(!readme.includes(retired), `README ainda usa o nome antigo: ${retired}`);
}

for (const file of htmlFiles) {
  const source = readFileSync(join(root, file), 'utf8');

  for (const retired of retiredReferences) {
    assert.ok(!source.includes(retired), `${file} ainda usa o nome antigo: ${retired}`);
  }

  for (const match of source.matchAll(/(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
    let localPath = join(root, decodeURIComponent(match[1]).slice(1));
    if (existsSync(localPath) && statSync(localPath).isDirectory()) localPath = join(localPath, 'index.html');
    assert.ok(existsSync(localPath), `${file} aponta para um arquivo ausente: ${match[1]}`);
  }

  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    assert.match(match[0], /\balt="[^"]*"/, `${file} possui imagem sem atributo alt.`);
    assert.match(match[0], /\bwidth="\d+"/, `${file} possui imagem sem largura definida.`);
    assert.match(match[0], /\bheight="\d+"/, `${file} possui imagem sem altura definida.`);
    const cover = match[0].match(/\bsrc="\/assets\/covers\/([a-z0-9-]+)\.webp"/);
    if (cover) {
      assert.match(match[0], /\bsrcset="[^"]+-960\.webp 960w,[^"]+\.webp 1916w"/, `${file} possui capa sem versão responsiva.`);
      assert.ok(existsSync(join(root, 'assets', 'covers', `${cover[1]}-960.webp`)), `${file} referencia miniatura ausente para ${cover[1]}.`);
    }
  }

  for (const match of source.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) {
    assert.match(match[0], /\brel="[^"]*noopener[^"]*"/, `${file} abre nova aba sem rel=noopener.`);
  }

  if (file !== '404.html' && !file.startsWith('google')) {
    assert.match(source, /<meta name="description" content="[^"]+"/, `${file} não possui descrição SEO.`);
    assert.match(source, /<link rel="canonical" href="https:\/\/infotech-io\.com\.br\/[^"]*"/, `${file} não possui URL canônica.`);
    assert.equal((source.match(/<h1\b/gi) || []).length, 1, `${file} deve ter exatamente um H1.`);
  }
}

const expectedDestinations = new Map([
  ['stoski-films', 'https://lucasjanoca.github.io/stoski-films/'],
  ['italo-efootball', 'https://lucasjanoca.github.io/italo-efootball/'],
  ['empilhadores', 'https://lucasjanoca.github.io/Sistema-De-Empilhamento-e-Checklist/empilhadores/'],
]);
for (const [id, demo] of expectedDestinations) {
  assert.equal(projects.find((project) => project.id === id)?.demo, demo, `Destino publicado incorreto para ${id}.`);
}

console.log('Site quality: OK');
