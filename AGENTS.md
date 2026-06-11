# review-funnel-master

QR-based customer review funnel for EESWEB (originally), now **Ratify** (rebrand).
Cloudflare Pages + Functions (serverless) + Firestore. Local Node fallback in `server.js`.

## Live project (as of 2026-06-11)
- Cloudflare Pages project name: `ratify` (URL: https://ratify.pages.dev)
- Cloudflare account: aniket.eesweb@gmail.com (Account ID: `6c2cd9071dc7de1a1f819b88deea0a6e`)
- KV namespace: `RF_SETTINGS` (id: `e8c0d6b708f046cbaf251010851902cd`) — reused from old setup
- Local git repo at `C:\Users\paras\Desktop\Workspace\review-funnel-master`
- GitHub repo: https://github.com/Latisha05/review-funnel (not yet pushed)

## How to deploy
```
deploy.cmd           # production (main branch)
deploy.cmd preview   # preview branch
```
Reads creds from `.env.secrets` (gitignored, lives in project root).

## Required secrets (per env, not in wrangler.toml)
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (keep \n markers)
- `GEMINI_API_KEY`
- `AUTH_SECRET`

## Key gotchas
- `wrangler.toml` had old `APP_BASE_URL=https://review-funnel-7h2.pages.dev` hardcoded — fixed to `https://ratify.pages.dev`
- Originally a Shelar TVS demo (`shelar-tvs-*` files, Shelar-flavored topics/prompts in `wrangler.toml`). The .env has `APP_BUSINESS_NAME="Ratify"` but kept the Shelar TVS `REVIEW_SYSTEM_PROMPT` as the default AI prompt — verify this is intentional if revisiting.
- `GOOGLE_PLACE_ID` left empty in wrangler.toml (set per-business in dashboard or Firestore).
