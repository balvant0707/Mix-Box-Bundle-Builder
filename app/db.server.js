import { PrismaClient } from "@prisma/client";

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const normalizedDatabaseUrl = rawDatabaseUrl?.replace(/^"(.*)"$/, "$1");

if (!normalizedDatabaseUrl) {
  throw new Error("[DB Init] DATABASE_URL is missing");
}

if (!/^mysqls?:\/\//i.test(normalizedDatabaseUrl)) {
  throw new Error(
    `[DB Init] DATABASE_URL must start with mysql:// or mysqls:// (received: ${normalizedDatabaseUrl.slice(0, 30)})`,
  );
}

// In serverless, apply sane Prisma pool defaults unless already set in DATABASE_URL:
// connection_limit=5 and pool_timeout=30 (seconds).
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function asPositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function applyPrismaPoolParams(databaseUrl, serverless) {
  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    // Fallback to the original URL if parsing fails unexpectedly.
    return databaseUrl;
  }

  // Serverless: allow 3 connections per instance so Promise.all() loaders that
  // fire 2-3 concurrent queries don't time out waiting for a single slot.
  // pool_timeout raised to 20s to handle cold-start latency on shared hosting.
  const defaultConnectionLimit = serverless ? 3 : null;
  const defaultPoolTimeout = serverless ? 20 : null;

  const configuredConnectionLimit = asPositiveInt(process.env.PRISMA_CONNECTION_LIMIT);
  const configuredPoolTimeout     = asPositiveInt(process.env.PRISMA_POOL_TIMEOUT);

  if (!parsedUrl.searchParams.has("connection_limit")) {
    const connectionLimit = configuredConnectionLimit ?? defaultConnectionLimit;
    if (connectionLimit) parsedUrl.searchParams.set("connection_limit", String(connectionLimit));
  }

  if (!parsedUrl.searchParams.has("pool_timeout")) {
    const poolTimeout = configuredPoolTimeout ?? defaultPoolTimeout;
    if (poolTimeout) parsedUrl.searchParams.set("pool_timeout", String(poolTimeout));
  }

  // Always set a TCP connect timeout so Vercel functions fail fast instead of
  // hanging for 30 s when the DB host is unreachable.
  if (!parsedUrl.searchParams.has("connect_timeout")) {
    parsedUrl.searchParams.set("connect_timeout", "10");
  }

  return parsedUrl.toString();
}

const dbUrl = applyPrismaPoolParams(normalizedDatabaseUrl, isServerless);

process.env.DATABASE_URL = dbUrl;

// Use globalThis singleton in ALL environments to avoid multiple client instances
// within the same module cache (dev hot-reload or serverless warm containers).
if (!globalThis.__prismaClient) {
  try {
    globalThis.__prismaClient = new PrismaClient();
  } catch (e) {
    console.error("[DB Init] Failed to create PrismaClient instance:", e);
    // Ensure globalThis.__prismaClient is explicitly undefined if it fails
    globalThis.__prismaClient = undefined;
  }
}

const prisma = globalThis.__prismaClient;
const prismaProvider = prisma?._engineConfig?.activeProvider;

if (prismaProvider && prismaProvider !== "mysql") {
  throw new Error(
    `[DB Init] Prisma client provider is '${prismaProvider}', expected 'mysql'. Run 'npx prisma generate' during deployment.`,
  );
}

// Persist across hot-reloads AND across warm serverless invocations in the
// same container so the DDL only fires once per process lifetime.
// Retry a DB operation with exponential backoff for transient connection errors.
export async function withDbRetry(fn, { retries = 3, delayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const errMessage = err?.message || "";
      // MySQL error code embedded in PrismaClientUnknownRequestError messages
      const mysqlCode = (() => {
        const m = errMessage.match(/code:\s*(\d+)/);
        return m ? Number(m[1]) : null;
      })();
      const isTransient =
        errMessage.includes("Can't reach database") ||
        errMessage.includes("Server has closed the connection") ||
        errMessage.includes("Connection terminated unexpectedly") ||
        errMessage.includes("Connection refused") ||
        errMessage.includes("ECONNREFUSED") ||
        errMessage.includes("ETIMEDOUT") ||
        errMessage.includes("Timed out fetching a new connection") ||
        errMessage.includes("Prisma session storage is not ready") ||
        errMessage.includes("Error obtaining session table") ||
        errMessage.includes("does not exist in the current database") ||
        // MySQL 1205: lock wait timeout - concurrent upserts on the same row
        errMessage.includes("Lock wait timeout exceeded") ||
        mysqlCode === 1205 ||
        // MySQL 1213: deadlock - retry immediately resolves it
        errMessage.includes("Deadlock found when trying to get lock") ||
        mysqlCode === 1213 ||
        err?.code === "P1001" ||       // Prisma: unreachable
        err?.code === "P1002" ||       // Prisma: timed out
        err?.code === "P1017" ||       // Prisma: connection closed by server
        err?.code === "P2024" ||       // Prisma: connection pool timeout
        err?.errorCode === "P1001" ||  // Prisma: unreachable
        err?.errorCode === "P1002" ||  // Prisma: timed out
        err?.errorCode === "P1017" ||  // Prisma: connection closed by server
        err?.errorCode === "P2024";    // Prisma: connection pool timeout
      if (!isTransient || attempt === retries) break;
      // Lock/deadlock errors resolve faster - use a short random jitter so
      // concurrent retries don't collide again on the exact same tick.
      const isLockError = mysqlCode === 1205 || mysqlCode === 1213 ||
        errMessage.includes("Lock wait timeout") || errMessage.includes("Deadlock");
      const baseWait = isLockError ? 100 : delayMs * 2 ** attempt;
      const wait = baseWait + Math.floor(Math.random() * 100);
      console.warn(`[DB] transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${wait}ms...`, err?.message);
      if (!isLockError) {
        try {
          // Drop stale pooled connections before retrying.
          await prisma.$disconnect();
        } catch {
          // Best effort reconnect hint only.
        }
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// `npm run migrate:deploy` (wired into vercel.json's buildCommand and the
// docker-start/setup scripts) already applies the Prisma migration history on
// every deploy, so schema no longer needs to be hand-rolled here. Kept as a
// no-op so existing call sites don't need to change.
export function ensureAppTables() {
  return Promise.resolve();
}

export default prisma;
