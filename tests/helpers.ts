import type { NextRequest } from "next/server";

// Minimal stand-in for a NextRequest carrying a Bearer token. requireAuth() only ever
// touches req.headers.get("authorization") on the header path, so a plain Headers object
// is sufficient — this keeps the unit tests free of the full Next request machinery (and,
// crucially, off the cookies() code path, which throws outside a request scope).
export function bearerReq(token?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return { headers } as unknown as NextRequest;
}

// Assert that `fn` throws, and hand the thrown value to `check` for further assertions.
// node:assert's throws() predicate swallows the error object; this returns it instead.
export function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected function to throw, but it returned normally");
}
