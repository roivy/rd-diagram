## What changed

<!-- A short, human summary of the change. -->

## Why

<!-- The problem or use case this addresses. -->

## Verification

<!-- How you verified it. The engine is deterministic: run the relevant gates. -->

- [ ] `npm run check:viewer && npm run check:brand-marks && npm run check:validators && npm run check:release-identity`
- [ ] `node test/golden.mjs` (baselines refreshed via `bash ../tools/refresh_baselines.sh` if templates/renderers changed)
- [ ] `node ../scripts/run-tests.mjs` (or `npm test` locally)

## Notes

<!-- Anything reviewers should know: schema impact, migration, screenshots. -->
