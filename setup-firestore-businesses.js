const fs = require("fs");
const path = require("path");

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function getAccessToken(env) {
  const crypto = require("crypto");
  const now = Math.floor(Date.now() / 1000);
  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  return data.access_token;
}

async function upsertDoc(baseUrl, token, docId, fields) {
  const url = `${baseUrl}/${docId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Failed ${docId}:`, err);
  } else {
    console.log(`✓ ${docId}`);
  }
}

async function main() {
  const env = loadEnv(path.join(__dirname, ".env"));
  if (!env.FIREBASE_PROJECT_ID) { console.error("No Firebase credentials in .env"); process.exit(1); }

  const token = await getAccessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  console.log("Writing businesses...");
  await upsertDoc(`${base}/businesses`, token, "eesweb", {
    businessId: { stringValue: "eesweb" },
    name: { stringValue: "EESWEB" },
    logoUrl: { stringValue: "" },
    googlePlaceId: { stringValue: "" },
    reviewTopics: { stringValue: "Clean design,Fast delivery,Clear strategy,Helpful support,Quality leads,Smooth automation" },
    feedbackTopics: { stringValue: "Slow response,Website issue,Poor leads,Unclear updates,Automation issue,Billing concern" },
    reviewSystemPrompt: { stringValue: "You write realistic customer review suggestions for Google Reviews. Output only one review, with no title, no bullets, no quotes, and no explanation. Sound like a genuine customer, not a marketer." },
    aiTone: { stringValue: "Professional" },
    aiLength: { stringValue: "medium" },
    status: { stringValue: "active" },
  });

  await upsertDoc(`${base}/businesses`, token, "shelar-tvs", {
    businessId: { stringValue: "shelar-tvs" },
    name: { stringValue: "Shelar TVS" },
    logoUrl: { stringValue: "" },
    googlePlaceId: { stringValue: "CUylmtiX6yoSEAE" },
    reviewTopics: { stringValue: "New Bike Purchase,New Scooter Purchase,Test Ride Experience,Best Price/Deal,Quick Delivery,Smooth Paperwork,Easy EMI Process,Helpful Staff,Knowledgeable Executive,Genuine Parts,Timely Service" },
    feedbackTopics: { stringValue: "Service Delay,Long Wait for Delivery,Parts Issue,Hidden Charges,Staff Behavior,Test Ride Denied,Billing Problem,Insurance/Loan Issue,Lack of Information" },
    reviewSystemPrompt: { stringValue: "You write realistic, natural Google reviews from real customers of Shelar TVS, a TVS two-wheeler showroom and service centre in Pune. Output only one review — no title, no bullets, no quotes, no explanation. Sound like a genuine local customer sharing a real purchase or service experience, not a marketing copy. Vary sentence structure every time. Weave in one or two search-relevant phrases naturally — such as Shelar TVS, TVS showroom Pune, Apache near me, Jupiter near me, TVS bike near me, best TVS deals Pune, TVS service Pune, genuine TVS parts — only if they fit the sentence. Never list keywords. Mention concrete touches: a friendly executive, a test ride, smooth EMI, on-time delivery, fair pricing, clean workshop. Do not use emojis, hashtags, AI/SEO mentions, incentive language, or the phrase highly recommended more than once." },
    aiTone: { stringValue: "Enthusiastic" },
    aiLength: { stringValue: "medium" },
    status: { stringValue: "active" },
  });

  console.log("\nWriting branches...");
  await upsertDoc(`${base}/branches`, token, "eesweb-main", {
    businessId: { stringValue: "eesweb" },
    branchId: { stringValue: "main" },
    name: { stringValue: "Main" },
    status: { stringValue: "active" },
  });

  await upsertDoc(`${base}/branches`, token, "shelar-tvs-aranyeshwar", {
    businessId: { stringValue: "shelar-tvs" },
    branchId: { stringValue: "aranyeshwar" },
    name: { stringValue: "Aranyeshwar" },
    status: { stringValue: "active" },
  });

  await upsertDoc(`${base}/branches`, token, "shelar-tvs-balaji-nagar", {
    businessId: { stringValue: "shelar-tvs" },
    branchId: { stringValue: "balaji-nagar" },
    name: { stringValue: "Balaji Nagar" },
    status: { stringValue: "active" },
  });

  await upsertDoc(`${base}/branches`, token, "shelar-tvs-kothrud", {
    businessId: { stringValue: "shelar-tvs" },
    branchId: { stringValue: "kothrud" },
    name: { stringValue: "Kothrud" },
    status: { stringValue: "active" },
  });

  await upsertDoc(`${base}/branches`, token, "shelar-tvs-narhe", {
    businessId: { stringValue: "shelar-tvs" },
    branchId: { stringValue: "narhe" },
    name: { stringValue: "Narhe" },
    status: { stringValue: "active" },
  });

  console.log("\nWriting QR codes...");
  await upsertDoc(`${base}/qrCodes`, token, "eesweb-test", {
    businessId: { stringValue: "eesweb" },
    qrCodeId: { stringValue: "eesweb-test" },
    branchId: { stringValue: "main" },
    branchName: { stringValue: "Main" },
    label: { stringValue: "EESWEB Test QR" },
    source: { stringValue: "General" },
    status: { stringValue: "active" },
    redirectUrl: { stringValue: "/?business=eesweb&branch=main&qr=eesweb-test" },
  });

  await upsertDoc(`${base}/qrCodes`, token, "shelar-tvs-aranyeshwar", {
    businessId: { stringValue: "shelar-tvs" },
    qrCodeId: { stringValue: "shelar-tvs-aranyeshwar" },
    branchId: { stringValue: "aranyeshwar" },
    branchName: { stringValue: "Aranyeshwar" },
    label: { stringValue: "Shelar TVS Aranyeshwar" },
    source: { stringValue: "General" },
    status: { stringValue: "active" },
    redirectUrl: { stringValue: "/?business=shelar-tvs&branch=aranyeshwar&qr=shelar-tvs-aranyeshwar" },
  });

  await upsertDoc(`${base}/qrCodes`, token, "shelar-tvs-balaji-nagar", {
    businessId: { stringValue: "shelar-tvs" },
    qrCodeId: { stringValue: "shelar-tvs-balaji-nagar" },
    branchId: { stringValue: "balaji-nagar" },
    branchName: { stringValue: "Balaji Nagar" },
    label: { stringValue: "Shelar TVS Balaji Nagar" },
    source: { stringValue: "General" },
    status: { stringValue: "active" },
    redirectUrl: { stringValue: "/?business=shelar-tvs&branch=balaji-nagar&qr=shelar-tvs-balaji-nagar" },
  });

  await upsertDoc(`${base}/qrCodes`, token, "shelar-tvs-kothrud", {
    businessId: { stringValue: "shelar-tvs" },
    qrCodeId: { stringValue: "shelar-tvs-kothrud" },
    branchId: { stringValue: "kothrud" },
    branchName: { stringValue: "Kothrud" },
    label: { stringValue: "Shelar TVS Kothrud" },
    source: { stringValue: "General" },
    status: { stringValue: "active" },
    redirectUrl: { stringValue: "/?business=shelar-tvs&branch=kothrud&qr=shelar-tvs-kothrud" },
  });

  await upsertDoc(`${base}/qrCodes`, token, "shelar-tvs-narhe", {
    businessId: { stringValue: "shelar-tvs" },
    qrCodeId: { stringValue: "shelar-tvs-narhe" },
    branchId: { stringValue: "narhe" },
    branchName: { stringValue: "Narhe" },
    label: { stringValue: "Shelar TVS Narhe" },
    source: { stringValue: "General" },
    status: { stringValue: "active" },
    redirectUrl: { stringValue: "/?business=shelar-tvs&branch=narhe&qr=shelar-tvs-narhe" },
  });

  console.log("\n✓ All Firestore documents written.");
}

main().catch(e => { console.error(e.message); process.exit(1); });
