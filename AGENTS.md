# Work OS 2.0

- Read `docs/PRODUCT_REQUIREMENTS.md`, `docs/ROADMAP.md` and `docs/DEVELOPMENT_STATUS.md` before product changes. Latest direct user instructions take precedence.
- Work directly on `main`; make small verified commits. Run `npm run verify:local` (lint, typecheck, full tests, build) before pushing. `npm run verify` is the existing build-only staging command. Push is not deployment.
- Prototype Checker at `C:/WorkProjects/Prototype-Checker` and its GitHub repository are read-only references. Do not modify, deploy or migrate that project.
- Run all automated tests, migration rehearsals, restore drills and synthetic performance checks locally with Miniflare/local D1. Do not use remote D1 as a test fixture. Never add Cloudflare credentials to CI.
- No routine/daily legacy resync. Final synchronized transfer happens only after functional parity and direct user confirmation. Never clear production D1, delete production data or start a legacy migration without direct confirmation.
- Production deployment is a separate controlled release after local verification; production migrations require their own explicit authorization. A CLI flag is not user authorization.
- Finish the reliable manual workflow before AI, advertisement generation or autoposting. Keep these later phases out of the daily UI.
- Record implementation gaps honestly: code, a successful local test and a deployed/accepted feature are different evidence.
