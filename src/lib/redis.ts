import Redis from "ioredis";

// Redis backs OTP storage, refresh-token denylist, and rate limiting (Section 3.2).
// In dev it is optional: if REDIS_URL is unreachable we degrade gracefully so the
// app still boots without `docker compose up`.

const globalForRedis = globalThis as unknown as { redis?: Redis | null };

function create(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  try {
    const client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    client.on("error", (err) => {
      console.warn("[redis] connection error:", err.message);
    });
    return client;
  } catch (err) {
    console.warn("[redis] failed to initialise:", (err as Error).message);
    return null;
  }
}

export const redis = globalForRedis.redis ?? create();
if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

export function redisAvailable(): boolean {
  return !!redis && redis.status === "ready";
}
