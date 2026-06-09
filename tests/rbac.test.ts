import { test } from "node:test";
import assert from "node:assert/strict";
import type { Role } from "@prisma/client";
import { can, type Permission } from "@/lib/rbac";
import { requireAuth, AuthError } from "@/lib/auth";
import { signAccessToken } from "@/lib/jwt";
import { bearerReq, caught } from "./helpers";

const ALL_ROLES: Role[] = ["DOCTOR", "PATIENT", "SUPER_ADMIN", "LAB_TECHNICIAN", "RADIOLOGIST"];

// Mirror of the permission matrix (Section 2.4). Kept here independently so a drift in
// src/lib/rbac.ts is caught rather than silently rubber-stamped by importing the same data.
const EXPECTED: Record<Permission, Role[]> = {
  "prescription:create": ["DOCTOR"],
  "prescription:viewOwn": ["DOCTOR", "PATIENT", "SUPER_ADMIN"],
  "patient:viewRecords": ["DOCTOR", "PATIENT", "SUPER_ADMIN"],
  "report:upload": ["PATIENT", "LAB_TECHNICIAN", "RADIOLOGIST", "SUPER_ADMIN"],
  "consent:manage": ["PATIENT"],
  voiceInput: ["DOCTOR"],
  "document:download": ["DOCTOR", "PATIENT", "SUPER_ADMIN"],
  "whatsapp:share": ["DOCTOR", "PATIENT"],
  "analytics:view": ["DOCTOR", "SUPER_ADMIN"],
  "interaction:alerts": ["DOCTOR", "SUPER_ADMIN"],
  "user:manage": ["SUPER_ADMIN"],
};

test("can() matches the permission matrix for every role × permission cell", () => {
  for (const permission of Object.keys(EXPECTED) as Permission[]) {
    const allowed = new Set(EXPECTED[permission]);
    for (const role of ALL_ROLES) {
      assert.equal(
        can(role, permission),
        allowed.has(role),
        `can(${role}, ${permission}) should be ${allowed.has(role)}`,
      );
    }
  }
});

test("notable least-privilege guarantees", () => {
  assert.equal(can("PATIENT", "prescription:create"), false, "patients cannot prescribe");
  assert.equal(can("DOCTOR", "consent:manage"), false, "only patients manage consent");
  assert.equal(can("DOCTOR", "report:upload"), false, "doctors do not upload lab/radiology reports");
  assert.equal(can("PATIENT", "user:manage"), false, "user management is admin-only");
  assert.equal(can("SUPER_ADMIN", "user:manage"), true);
});

test("requireAuth returns the session for an authenticated, in-role user", () => {
  const token = signAccessToken({ sub: "doc_1", role: "DOCTOR", twoFactor: true });
  const session = requireAuth(bearerReq(token), ["DOCTOR"]);
  assert.equal(session.sub, "doc_1");
  assert.equal(session.role, "DOCTOR");
});

test("requireAuth without a role constraint admits any authenticated user", () => {
  const token = signAccessToken({ sub: "p_1", role: "PATIENT", twoFactor: false });
  assert.equal(requireAuth(bearerReq(token)).sub, "p_1");
});

test("requireAuth allows a user whose role is in the permitted set", () => {
  const token = signAccessToken({ sub: "admin_1", role: "SUPER_ADMIN", twoFactor: true });
  assert.equal(requireAuth(bearerReq(token), ["DOCTOR", "SUPER_ADMIN"]).role, "SUPER_ADMIN");
});

test("requireAuth throws 403 FORBIDDEN when the role is out of scope", () => {
  const token = signAccessToken({ sub: "p_2", role: "PATIENT", twoFactor: false });
  const err = caught(() => requireAuth(bearerReq(token), ["DOCTOR"]));
  assert.ok(err instanceof AuthError);
  assert.equal((err as AuthError).status, 403);
  assert.equal((err as AuthError).code, "FORBIDDEN");
});

test("requireAuth throws 401 UNAUTHORIZED for a missing or invalid token", () => {
  const garbage = caught(() => requireAuth(bearerReq("not.a.jwt"), ["DOCTOR"]));
  assert.ok(garbage instanceof AuthError);
  assert.equal((garbage as AuthError).status, 401);
  assert.equal((garbage as AuthError).code, "UNAUTHORIZED");

  // A token signed with the wrong secret must also be rejected.
  const forged = signAccessToken({ sub: "x", role: "DOCTOR", twoFactor: true }) + "tampered";
  const bad = caught(() => requireAuth(bearerReq(forged), ["DOCTOR"]));
  assert.ok(bad instanceof AuthError);
  assert.equal((bad as AuthError).status, 401);
});

test("requireAuth gates a privileged role that has not satisfied 2FA (2FA_REQUIRED)", () => {
  // A doctor whose session is not 2FA-satisfied must be blocked from feature endpoints.
  const token = signAccessToken({ sub: "doc_2", role: "DOCTOR", twoFactor: false });
  const err = caught(() => requireAuth(bearerReq(token), ["DOCTOR"]));
  assert.ok(err instanceof AuthError);
  assert.equal((err as AuthError).status, 403);
  assert.equal((err as AuthError).code, "2FA_REQUIRED");
});

test("requireAuth still admits a non-privileged role without 2FA", () => {
  // PATIENT/LAB/RADIOLOGIST do not require 2FA, so a non-satisfied session is fine.
  const token = signAccessToken({ sub: "p_3", role: "PATIENT", twoFactor: false });
  assert.equal(requireAuth(bearerReq(token)).sub, "p_3");
  assert.equal(requireAuth(bearerReq(token), ["PATIENT"]).role, "PATIENT");
});
