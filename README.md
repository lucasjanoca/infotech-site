# InfoTech.io — Site oficial e portfólio

Este é o site principal da InfoTech.io, com projetos, portfólio, soluções e contato, no domínio https://infotech-io.com.br/.

Os arquivos representam a vitrine oficial publicada. O sistema anterior de solicitações e área do cliente foi preservado, sem dados de produção, no repositório independente `lucasjanoca/infotech-sistema-demo`.

- Página inicial: `index.html`
- Projetos: `projetos/` e `projects.json`
- Soluções: `solucoes/`
- Estúdio: `estudio/`
- Contato: `contato/`
- Estilos e imagens: `assets/`

Site estático sem acesso a pedidos, senhas ou banco de produção. Não reintroduzir configuração Supabase do sistema anterior nesta vitrine.

## Verificação local

```bash
node --check assets/site.js
node tests/site-smoke.mjs
node tests/site-quality.mjs
node scripts/serve.mjs
node scripts/audit-performance.mjs http://127.0.0.1:4173/
node scripts/optimize-covers.mjs
```

A pesquisa que orienta a jornada comercial da página inicial está em `docs/pesquisa-marketing-conversao.md`.
