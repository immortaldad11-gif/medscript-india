import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/drugs/search?q=... — CDSCO drug autocomplete for the Rx form (Section 4.1.1).
export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["DOCTOR", "SUPER_ADMIN"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return ok([]);

  // Match either the brand/display name or the generic molecule, so a doctor can
  // find a drug by either (Section 4.1.1).
  const drugs = await prisma.drug.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { genericName: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 25,
    orderBy: { name: "asc" },
  });
  return ok(drugs);
}
