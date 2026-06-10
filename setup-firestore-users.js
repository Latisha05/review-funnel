const fs = require("fs");
const path = require("path");

// Load Firebase credentials from .env
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const contents = fs.readFileSync(filePath, "utf8");
  const env = {};
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      env[key] = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      env[key] = value.slice(1, -1);
    } else {
      env[key] = value;
    }
  }

  return env;
}

async function setupFirestoreUsers() {
  const env = loadEnv(path.join(__dirname, ".env"));

  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error("Error: Firebase credentials not found in .env");
    console.error("Make sure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set.");
    process.exit(1);
  }

  // Get access token
  const crypto = require("crypto");
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const claim = Buffer.from(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const signInput = `${header}.${claim}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(privateKey, "base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const token = `${signInput}.${signature}`;

  // Request access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    console.error("Token request failed:", error);
    process.exit(1);
  }

  const { access_token } = await tokenResponse.json();

  // Delete all documents in clientUsers collection first
  console.log("Deleting existing clientUsers documents...");
  const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/clientUsers`;
  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (listResponse.ok) {
    const listData = await listResponse.json();
    const documents = listData.documents || [];

    for (const doc of documents) {
      const docId = doc.name.split("/").pop();
      const deleteUrl = `${listUrl}/${docId}`;
      await fetch(deleteUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${access_token}` },
      });
      console.log(`Deleted: ${docId}`);
    }
  }

  // Password hashing must match server.js hashPassword (scrypt, salt "review-funnel-auth", 64 bytes)
  const hashPassword = (password) =>
    crypto.scryptSync(password, "review-funnel-auth", 64).toString("hex");

  // Create new clientUsers documents
  const users = [
    {
      id: "YWRzLmVlc3dlYkBnbWFpbC5jb20",
      data: {
        email: { stringValue: "ads.eesweb@gmail.com" },
        passwordHash: { stringValue: hashPassword("eesweb@1") },
        role: { stringValue: "client" },
        client: { stringValue: "eesweb" },
        businessId: { stringValue: "eesweb" },
      },
    },
    {
      id: "c2hlbGFydHZzQGdtYWlsLmNvbQ",
      data: {
        email: { stringValue: "shelartvs@gmail.com" },
        passwordHash: { stringValue: hashPassword("eesweb@1") },
        role: { stringValue: "client" },
        client: { stringValue: "shelar-tvs" },
        businessId: { stringValue: "shelar-tvs" },
      },
    },
    {
      id: "YWRtaW5AZWVzd2ViLmlu",
      data: {
        email: { stringValue: "admin@eesweb.in" },
        passwordHash: { stringValue: hashPassword("eesweb@1") },
        role: { stringValue: "admin" },
        client: { stringValue: "eesweb" },
        businessId: { stringValue: "eesweb" },
      },
    },
  ];

  console.log("\nCreating new clientUsers documents...");

  for (const user of users) {
    const url = `${listUrl}?documentId=${user.id}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: user.data }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to create ${user.id}:`, error);
    } else {
      console.log(`Created: ${user.id}`);
    }
  }

  console.log("\n✓ Firestore users setup complete!");
}

setupFirestoreUsers().catch((error) => {
  console.error("Setup failed:", error.message);
  process.exit(1);
});
