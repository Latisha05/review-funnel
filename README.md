# Review Funnel

A mobile-first QR review page for routing happy customers toward Google Reviews and collecting unhappy customer feedback privately.

## What is built now

- One-click 1 to 5 rating flow.
- Ratings 4 and 5 show an editable AI review suggestion.
- Copy review button plus direct Google review redirect.
- Ratings 1 to 3 show a private feedback form.
- Firestore event storage through the local Node server.
- Gemini review generation using `gemini-3.5-flash-lite`, with a fallback review if the API is unavailable.

Run the local server, then open `http://127.0.0.1:5500`.
Use `http://127.0.0.1:5500/login` to sign in and `http://127.0.0.1:5500/dashboard` for the role-aware dashboard.

## Gemini Review Generation

Add your real Gemini key to `.env` only:

```text
GEMINI_API_KEY="..."
GEMINI_MODEL="gemini-3.5-flash-lite"
```

Do not paste the real key into `.env.example`; that file is only a shareable template. For Cloudflare Pages, set `GEMINI_API_KEY` as a secret instead of committing it.

If Gemini is unavailable or the key is missing, the page still generates a built-in fallback review.

## Environment File

`.env` has been created for your real keys. Keep it private. Use `.env.example` as the shareable template.

Important values:

- `GOOGLE_PLACE_ID`: used to build `https://g.page/r/[PLACE_ID]/review`.
  Leave this blank while testing AI review generation only.
- `REVIEW_TOPICS`: comma-separated 2-3 word positive review parameters for a specific client.
- `FEEDBACK_TOPICS`: comma-separated 2-3 word private feedback issue parameters for a specific client.
- `GEMINI_API_KEY`: paste your real Gemini key in `.env` only.
- `GEMINI_MODEL`: defaults to `gemini-3.5-flash-lite`.
- `REVIEW_SYSTEM_PROMPT`: controls the AI review style without editing code.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`: used by `server.js` to write Firestore securely.
  You can also paste the full Firebase service account JSON at the bottom of `.env`; `server.js` will read it automatically.
- WhatsApp values: needed later for owner alerts and customer messages.

## Run Locally

```bash
node server.js
```

Open:

```text
http://127.0.0.1:5500
```

Local dashboard:

```text
http://127.0.0.1:5500/login
http://127.0.0.1:5500/dashboard
```

Dynamic QR target:

```text
http://127.0.0.1:5500/r/eesweb-test
```

Use this URL inside any dynamic QR provider. The printed QR should point to `/r/{qrCodeId}`, not directly to `/`.
Later, you can change the redirect behavior in the app without changing the printed QR code.

## Dashboard

The dashboard is served from one root route. Client users see `dashboard.html`; admins see `admin.html`.

Client users are scoped to their `client`/`businessId` from `clientUsers` or local `auth_store.json`. Admin users can pass `?client={businessId}` through the admin UI to view or edit a tenant.

The dashboard edits tenant settings in `businesses/{businessId}`:

```text
Business name
Business, branch, and QR IDs
Google Place ID
Positive review parameters
Private feedback parameters
Gemini model
Review system prompt
```

Firebase service account values are not exposed in the dashboard.

## Firestore Setup

1. Create a Firebase project at `console.firebase.google.com`.
2. Add a web app inside the Firebase project.
3. Copy the Firebase config values into `.env`.
4. Enable Firestore Database in production mode.
5. Create a Firebase service account key:
   - Firebase Console -> Project settings -> Service accounts.
   - Click Generate new private key.
   - Copy `client_email` to `FIREBASE_CLIENT_EMAIL`.
   - Copy `private_key` to `FIREBASE_PRIVATE_KEY`.
   - Or paste the full downloaded JSON object at the bottom of `.env`.
6. Create dashboard users in `clientUsers/{base64url(email)}` with `email`, `role`, and `client`/`businessId`.
7. Seed the base business, branch, and QR documents:

```bash
node server.js --bootstrap
```

Firestore collections are created automatically when documents are written.

Use these collections:

```text
businesses/{businessId}
branches/{branchId}
qrCodes/{qrCodeId}
clientUsers/{base64url(email)}
ratings/{ratingId}
feedback/{feedbackId}
reviewEvents/{eventId}
postedReviews/{postedReviewId}
```

Suggested document fields:

```json
{
  "businessId": "abc",
  "branchId": "ravet",
  "qrCodeId": "eesweb-main-campaign",
  "redirectUrl": "/?business=eesweb&branch=main&qr=eesweb-main-campaign",
  "qrImageUrl": "/qr-codes/main.png",
  "source": "support-desk",
  "rating": 5,
  "reviewText": "Only saved when customer clicks Google review or I posted it",
  "issues": ["Delay", "Service issue"],
  "message": "Feedback message",
  "customer": {
    "name": "Optional",
    "phone": "Optional"
  },
  "createdAt": "server timestamp"
}
```

Minimum Firestore security idea:

```text
- Public users can only create ratings and feedback.
- Public users cannot read dashboard data.
- Business owners can only read their own business documents.
- Super admin can read all documents.
```

Use Firebase Auth custom claims later for `superAdmin`, `businessOwner`, and `staff` roles.

## Simpler Database Recommendation

For the first working SaaS version, Supabase Postgres is simpler than Firestore because this app has relational data:

- Businesses have many branches.
- Branches have many QR codes.
- QR codes can map to branches, staff members, service sources, and campaigns.
- Dashboards need filters, counts, averages, date ranges, and conversion rates.

Suggested MVP tables:

```text
businesses
branches
staff
qr_codes
ratings
feedback
review_events
posted_reviews
```

Use Firestore if you want Firebase hosting, quick realtime updates, and simple document writes. Use Supabase or Postgres if you want cleaner analytics, SQL reports, subscriptions, and easier multi-tenant dashboard queries.
