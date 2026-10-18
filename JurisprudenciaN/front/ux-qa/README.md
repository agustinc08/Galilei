# UX QA harness

This is a reusable browser smoke harness for the Galilei / BJC frontend. It exercises public routes with deterministic synthetic API responses and reports browser health, responsive layout, keyboard behavior, screenshots, Search UI controls, and the Viewer shell. Search semantics, real-user authorization, backend ACL security, and pixel-diff comparison are outside its scope.

## Preconditions

- Install the frontend's existing dependencies with the repository's pnpm workspace workflow. Playwright is already a development dependency; this harness adds no package.
- By default the runner starts a temporary Next.js Webpack preview and a synthetic API fixture on dynamically assigned loopback ports, then stops only those processes it started. Webpack is selected because the local Windows Turbopack preview panics while compiling routes.
- To reuse an existing preview, set `UX_QA_BASE_URL` to its loopback URL. The test config rejects non-loopback URLs.
- Browser API calls are intercepted and answered by synthetic fixtures. For an existing app, keep its server-side `NEXT_PUBLIC_API_URL` local and isolated; do not point it at production or institutional services.
- Chromium must be installed for the existing Playwright version.

PowerShell, standalone run:

```powershell
npm run qa:ux
```

PowerShell, reusing an existing local preview:

```powershell
$env:UX_QA_BASE_URL = 'http://127.0.0.1:<preview-port>'
npm run qa:ux
```

`UX_QA_REPORT_DIR` optionally changes the run output directory. By default reports and screenshots go to the ignored `_recovery-work/ux-qa-automation-prep1/runs/latest/` directory. Screenshot filenames are stable per scenario and viewport.

## Commands

- `npm run qa:ux` — helper self-tests and the public browser suite; no credentials required.
- `npm run qa:ux:public` — public home, login, Search, help dialog, pagination, and Viewer shell.
- `npm run qa:ux:responsive` — public responsive matrix.
- `npm run qa:ux:viewer` — Viewer shell responsive journeys.
- `npm run qa:ux:self` — quick helper and fixture checks without a browser or running preview.
- `npm run lint:ux` — lint only the new harness and its specs.
- `npm run qa:ux:auth` — opt-in future suite. Requires `UX_QA_AUTH_ENABLED=1`, `UX_QA_AUTH_USER`, and `UX_QA_AUTH_PASSWORD`; values stay environment-only. The scenarios remain deferred until the reconciled authenticated routes and permitted auth fixture exist.

The existing `test:e2e` command retains its separate DB-backed configuration and is not used by this harness. No CI workflow is changed.

## Public and authenticated routes

Current public routes are `/`, `/login`, `/consulta`, and `/fallos/ux-qa-001` (the last uses a synthetic fixture). Authenticated routes `/galilei`, `/personal`, and `/spaces/manage` are present. The auth descriptors cover one or multiple dependencies, personal ownership, shared membership and non-membership, restricted access outcomes, and an admin operator. DB-backed authenticated UI and ACL scenarios are exercised by the existing Sprint 15.6.1 E2E fixture; this mock harness never certifies `ACL_SECURITY_PASS`.

## Reports and interpretation

Every browser run writes `qa-report.json` and `qa-summary.md`, plus screenshots, under the configured ignored run directory. HTTP failures, page errors, React warnings, fixture misses, overflow measurements, and internal scroll candidates are kept separately. Blob aborts during browser cleanup and in-app Viewer / panel scrolling are classified as expected. PDF rendering is reported separately from the mandatory Viewer shell because browser-native PDF support can vary.

The fixture contains only invented values and a tiny generated one-page PDF. The Search scenario checks input, submission, results, filters, clearing, help, pagination, result selection, and navigation back from Viewer; it does not evaluate result relevance or Search semantics. Reduced motion is enabled for the public suite.

Historical screenshots under `_recovery-work/ux-prep1/screenshots/` remain untouched and are not used for pixel-diff comparison.
