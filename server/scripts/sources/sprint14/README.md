# Sprint 14 source tooling

`core.cjs` contains offline, deterministic helpers for parsing the public CSJN tomo catalogue and CIJ sitemap, recording open-data catalogue results, classifying Civil evidence, reconciling identity, and verifying PDF bytes. The tests use sanitized local fixtures and do not access the network.

The live discovery manifests for this run are in `C:\proyecto triple\_recovery-work\sprint14`. They are intentionally outside source control and contain URLs and public metadata only. There is no automatic PDF downloader in this package: the runtime rejected a direct official PDF download before execution, and the other source routes are restricted by their current robots rules or a visible CAPTCHA.

Run the contract tests with:

```powershell
node --test scripts/sources/sprint14/core.test.cjs
```

Do not use these parsers as permission to fetch a URL. Refresh discovery only through a currently public, permitted user-facing route, reread its robots policy first, keep requests sequential and slow, and preserve every restriction as a pending manifest state.
