# Contributing to Roivy Diagram

Thanks for helping improve the engine. This project is deterministic by
design — every contribution runs the same gates, so reviews stay about
intent, not formatting.

## Getting started

```bash
git clone https://github.com/roivy/rd-diagram.git
cd rd-diagram/rd-diagram
npm install
npm test
```

`npm test` chains: template/brand-mark/validator/identity checks → golden
renders → the full unit + real-browser suite (a Chromium-family browser is
required; it is auto-detected).

## The change loop

1. **Renderer or viewer change** — sources live in `rd-diagram/renderers/`
   and the repo-root `viewer/`. After any viewer/template change, regenerate
   the embedded template and baselines:

   ```bash
   cd rd-diagram && npm run generate:viewer
   bash ../tools/refresh_baselines.sh
   ```

2. **Golden baselines** — renders are byte-deterministic; if your change is
   intentional, refresh the baselines with the command above and commit them
   together with your change.

3. **New example content** — follow the schemas in `rd-diagram/schemas/`;
   validation runs on every render.

4. **Run the full suite before opening a PR.**

## Pull requests

- One logical change per PR.
- Include regenerated baselines in the same commit as the change that
  requires them.
- Describe verification in the PR template.
- Keep artifacts fully offline: no network calls, no external font/CDN
  references in generated HTML.

## Reporting bugs

Open an issue with the diagram type, the input JSON (redacted as needed),
and the generated HTML. Deterministic inputs make bugs very fixable.
