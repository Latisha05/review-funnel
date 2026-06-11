import { firestoreGet, getMergedEnv, json } from "./_shared.js";

const COOKIE_NAME = "rf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function handleLogin(ctx) {
  const env = await getMergedEnv(ctx.env);
  const body = await ctx.request.json();
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");
  if (!email || !password) {
    return json({ error: "Email and password are required." }, 400);
  }

  await verifyFirebasePassword(env, email, password);
  const user = await getClientUserByEmail(env, email);
  if (!user) {
    return json({ error: "This user is not mapped to a dashboard tenant." }, 403);
  }

  const session = {
    email,
    role: user.role === "admin" ? "admin" : "client",
    client: user.client || user.businessId || env.BUSINESS_ID || "eesweb",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signSession(env, session);

  return json(
    { ok: true, email, role: session.role, client: session.client },
    200,
    {
      "Set-Cookie": serializeCookie(COOKIE_NAME, token, {
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(ctx.request.url).protocol === "https:",
      }),
    },
  );
}

export async function handleSession(ctx) {
  const session = await getSession(ctx);
  if (!session) return json({ authenticated: false });
  return json({
    authenticated: true,
    session: {
      email: session.email,
      role: session.role || "client",
      client: session.client,
      expiresAt: new Date(session.exp * 1000).toISOString(),
    },
  });
}

export function handleLogout(ctx) {
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": serializeCookie(COOKIE_NAME, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(ctx.request.url).protocol === "https:",
      }),
    },
  );
}

export async function requireSession(ctx) {
  const session = await getSession(ctx);
  if (!session) {
    return null;
  }
  return session;
}

export function resolveTenant(ctx, session, options = {}) {
  const url = new URL(ctx.request.url);
  const requestedClient = normalizeSlug(url.searchParams.get("client") || "");
  const isAdmin = session?.role === "admin";
  if (isAdmin) {
    if (options.allowAll && (!requestedClient || requestedClient === "all")) {
      return { clientId: "", allTenants: true, isAdmin };
    }
    return { clientId: requestedClient || normalizeSlug(session.client), allTenants: false, isAdmin };
  }
  return { clientId: normalizeSlug(session?.client), allTenants: false, isAdmin: false };
}

export function assertTenantAccess(document, clientId) {
  if (!document) {
    return json({ error: "Record not found." }, 404);
  }
  if (clientId && document.businessId !== clientId) {
    return json({ error: "You do not have access to this tenant's data." }, 403);
  }
  return null;
}

async function getSession(ctx) {
  const env = await getMergedEnv(ctx.env);
  const token = readCookie(ctx.request, COOKIE_NAME);
  if (!token) return null;
  const session = await verifySession(env, token);
  if (!session || session.exp * 1000 <= Date.now()) return null;
  return session;
}

async function verifyFirebasePassword(env, email, password) {
  if (!env.FIREBASE_API_KEY) {
    throw new Error("FIREBASE_API_KEY is required for Pages login.");
  }
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data.error?.message || "");
    if (
      message.includes("INVALID_PASSWORD") ||
      message.includes("EMAIL_NOT_FOUND") ||
      message.includes("INVALID_LOGIN_CREDENTIALS") ||
      message.includes("USER_NOT_FOUND")
    ) {
      throw new Error("Incorrect email or password.");
    }
    throw new Error("Sign in failed. Please try again.");
  }
}

async function getClientUserByEmail(env, email) {
  const normalized = normalizeEmail(email);
  const encodedKey = toBase64Url(new TextEncoder().encode(normalized));
  return (
    (await firestoreGet(env, `clientUsers/${encodedKey}`)) ||
    (await firestoreGet(env, `clientUsers/${encodeURIComponent(normalized)}`))
  );
}

async function signSession(env, payload) {
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signHmac(env, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifySession(env, token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;
  const expected = await signHmac(env, encodedPayload);
  if (expected !== signature) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
  } catch {
    return null;
  }
}

async function signHmac(env, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.AUTH_SECRET || env.FIREBASE_PRIVATE_KEY || env.FIREBASE_CLIENT_EMAIL || "review-funnel-session"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function readCookie(request, name) {
  const cookies = String(request.headers.get("cookie") || "").split(";").map((item) => item.trim());
  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    const key = index >= 0 ? cookie.slice(0, index) : cookie;
    if (key === name) return decodeURIComponent(index >= 0 ? cookie.slice(index + 1) : "");
  }
  return "";
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
