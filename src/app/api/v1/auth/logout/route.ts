import { ok } from "@/lib/http";
import { endSession } from "@/lib/session";

export async function POST() {
  await endSession();
  return ok({ loggedOut: true });
}
