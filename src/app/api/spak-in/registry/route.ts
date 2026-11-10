import { NextResponse } from "next/server";
import { ASSET_REGISTRY_META, listAssets, listNetworks } from "@/spak-in";

/** GET /api/spak-in/registry  Supported networks and verified assets. */
export async function GET() {
  return NextResponse.json({ meta: ASSET_REGISTRY_META, networks: listNetworks(), assets: listAssets() });
}
