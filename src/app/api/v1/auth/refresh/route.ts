import { cookies } from "next/headers";
import { ok, fail } from "@/lib/http";
import { rotateSession } from "@/lib/session";
import { REFRESH_COOKIE } from "@/lib/auth";

// POST /api/v1/auth/refresh — rotate the refresh token, issue a new access token.
export async function POST() {
  const raw = cookies().get(REFRESH_COOKIE)?.value;
  if (!raw) return fail("No refresh token", 401, "NO_REFRESH");
  try {
    await rotateSession(raw);
    return ok({ refreshed: true });
  } catch (err) {
    return fail("Could not refresh session", 401, "REFRESH_FAILED");
  }
}
