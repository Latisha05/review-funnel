const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const contents = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(JSON.stringify({ iss: env.FIREBASE_CLIENT_EMAIL, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${sign.sign(privateKey, "base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  return (await res.json()).access_token;
}

function parseDoc(doc) {
  const fields = doc.fields || {};
  const data = {};
  for (const [k, v] of Object.entries(fields)) {
    data[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? v.doubleValue ?? null;
  }
  data._id = doc.name.split("/").pop();
  return data;
}

async function listCollection(base, token, collection) {
  const res = await fetch(`${base}/${collection}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.documents || []).map(parseDoc);
}

async function main() {
  const env = loadEnv(path.join(__dirname, ".env"));
  const token = await getAccessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  const collections = ["businesses", "branches", "qrCodes"];
  for (const col of collections) {
    const docs = await listCollection(base, token, col);
    console.log(`\n=== ${col} (${docs.length} docs) ===`);
    docs.forEach(d => console.log(JSON.stringify(d)));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
