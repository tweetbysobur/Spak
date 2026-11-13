import { NextResponse } from "next/server";
import { ASSET_REGISTRY_META, listAssets, listNetworks } from "@/spak-in";
import { destinationProblem, sourceProblem } from "@/execution/v1-scope";

/**
 * GET /api/spak-in/registry  Networks and verified assets, each flagged with what V1 allows:
 * `source` (can send from) and `destination` (SPak can verify delivery). The server enforces the same rules.
 */
export async function GET() {
  return NextResponse.json({
    meta: ASSET_REGISTRY_META,
    networks: listNetworks().map((n) => ({ ...n, source: !sourceProblem(n.id), destination: !destinationProblem(n.id) })),
    assets: listAssets().map((a) => ({ ...a, destination: !destinationProblem(a.network, a.id) })),
  });
}
