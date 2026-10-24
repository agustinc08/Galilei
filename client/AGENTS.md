# Client development

- Client is a React + Vite + TypeScript SPA. Keep browser-safe configuration under `VITE_*`; never put credentials or server secrets in client env variables.
- The API base is `VITE_API_URL` (defaults to same-origin `/api`). Development routes `/api` through the Vite proxy configured by `BJC_DEV_API_PROXY`.
- Keep browser routing in React Router and preserve authenticated guards, query strings, direct-link paths, and role checks.
- Run client changes through `pnpm typecheck`, `pnpm lint`, `pnpm test`, and the relevant Playwright/UX checks.
- Production hosting serves `client/dist` as static files and rewrites unknown application paths to `index.html`; `vite preview` is for local verification only.
