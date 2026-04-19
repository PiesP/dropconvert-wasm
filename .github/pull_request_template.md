# Summary

Explain **what** this pull request changes and **why**.

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal improvement
- [ ] Documentation only

## How to test

Describe how reviewers can verify the change, including relevant npm scripts
(for example):

```bash
pnpm quality
pnpm build
```

If the change touches optional paths such as batch conversion, mention any required build-time flags (for example `VITE_FEATURE_BATCH=1`).

If tests are not required, briefly explain why.

## Checklist

- [ ] Code, comments, and docs are written in **English**
- [ ] I confirmed the app still runs fully in-browser (no server upload)
- [ ] I preserved COOP/COEP support (`public/_headers`, `vite.config.ts`) when SharedArrayBuffer is required
- [ ] I ran `pnpm quality`
- [ ] I ran `pnpm build`
- [ ] I updated docs and env-flag guidance if user-visible or workflow-visible behavior changed
- [ ] If dependencies changed, I regenerated `public/licenses/third-party-licenses*.json`
- [ ] I reviewed `.github/SECURITY.md` if security/privacy behavior changed
