# Review Funnel

A mobile-first QR review page for routing happy customers toward Google Reviews and collecting unhappy customer feedback privately.

## What is built now

- One-click 1 to 5 rating flow.
- Ratings 4 and 5 show an editable AI review suggestion.
- Copy review button plus direct Google review redirect.
- Ratings 1 to 3 show a private feedback form.
- Firestore event storage through the local Node server.
- Ollama `llama3.2:3b` support with a fallback review if Ollama is unavailable.

Run the local server, then open `http://127.0.0.1:5500`.
Use `http://127.0.0.1:5500/dashboard.html` to edit clone-friendly business, QR, topic, and review prompt settings.

## Local Ollama

Install and run Ollama, then pull the model:

```bash
ollama pull llama3.2:3b
ollama run llama3.2:3b
```

The page calls:

```text
http://localhost:11434/api/generate
```

If the browser blocks the local request or Ollama is not running, the page still generates a built-in fallback review.

## Environment File

`.env` has been created for your real keys. Keep it private. Use `.env.example` as the shareable template.

Important values:

- `GOOGLE_PLACE_ID`: used to build `https://g.page/r/[PLACE_ID]/review`.
  Leave this blank while testing AI review generation only.
- `REVIEW_TOPICS`: comma-separated 2-3 word positive review parameters for a specific client.
- `FEEDBACK_TOPICS`: comma-separated 2-3 word private feedback issue parameters for a specific client.
- `OLLAMA_BASE_URL`: usually `http://localhost:11434`.
- `OLLAMA_MODEL`: use `llama3.2:3b`.
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
http://127.0.0.1:5500/dashboard.html
```

Dynamic QR target:

```text
http://127.0.0.1:5500/r/eesweb-test
```

Use this URL inside any dynamic QR provider. The printed QR should point to `/r/{qrCodeId}`, not directly to `/`.
Later, you can change the redirect behavior in the app without changing the printed QR code.

## Dashboard

The dashboard edits safe `.env` settings only:

```text
Business name
Business, branch, and QR IDs
Google Place ID
Positive review parameters
Private feedback parameters
Ollama URL and model
Review system prompt
```

Firebase service account values are not exposed in the dashboard. Keep the dashboard local until auth is added.

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
6. Seed the base business, branch, and QR documents:

```bash
node server.js --bootstrap
```

Firestore collections are created automatically when documents are written.

Use these collections:

```text
businesses/{businessId}
branches/{branchId}
qrCodes/{qrCodeId}
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
