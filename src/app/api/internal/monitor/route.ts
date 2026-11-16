import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/database";
import { monitorAssociations } from "@/agents/wallets";
import { agentAccountService } from "@/server/agents";
import { spak } from "@/server/spak";
import { AlertService } from "@/ops/alerts";
import { RateLimiter } from "@/ops/rate-limit";
import { logEvent } from "@/ops/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Internal monitoring endpoint. Called by Vercel Cron (Authorization: Bearer $CRON_SECRET) or an external scheduler
 * (Bearer $SPAK_MONITOR_SECRET). No cookies, no browser use. Fails closed when no secret is configured.
 */
function authorized(req: Request): boolean | null {
  const secrets = [process.env.CRON_SECRET, process.env.SPAK_MONITOR_SECRET].filter((s): s is string => !!s && s.length >= 16);
  if (!secrets.length) return null;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return secrets.some((s) => timingSafeEqual(h(s), h(got)));
}

async function run(req: Request) {
  const ok = authorized(req);
  if (ok === null) return NextResponse.json({ error: { code: "MONITOR_NOT_CONFIGURED" } }, { status: 503 });
  if (!ok) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  const trigger = req.headers.get("user-agent")?.includes("vercel-cron") ? "vercel-cron" : "scheduler";
  try {
    const summary = await (await spak()).monitor.run({ trigger, limit: 25, budgetMs: 45_000 });
    // Same scheduler, same secret: dedicated Agent account re-verification (read-only on NEAR) and association monitoring.
    const agents = await (await agentAccountService()).recheckDue({ limit: 25 }).catch((e) => { console.error("[spak-monitor] agent recheck failed", (e as Error).message); return { error: "AGENT_RECHECK_FAILED" }; });
    const associations = await monitorAssociations(await getDb(), new Date()).catch((e) => { console.error("[spak-monitor] association monitor failed", (e as Error).message); return { error: "ASSOCIATION_MONITOR_FAILED" }; });
    // Same scheduler: prepare due recurring payments (fresh quote each; the user's wallet still signs every deposit).
    const schedules = await (await spak()).schedules.processDue({ limit: 25 }).then((r) => ({ created: r.created, prepared: r.prepared, failed: r.failed }))
      .catch((e) => { logEvent("error", "payment_schedules.run_failed", { error: (e as Error).message }); return { error: "PAYMENT_SCHEDULES_FAILED" }; });
    await new RateLimiter(await getDb()).prune().catch((e) => logEvent("warn", "rate_limit.prune_failed", { error: (e as Error).message }));
    // Operations: derive alerts from state and deliver them. A failure here is reported, never hidden.
    const ops = new AlertService(await getDb());
    const alerts = await ops.scan().then(async (open) => ({ open: open.length, delivery: await ops.deliver() })).catch((e) => { logEvent("error", "alert.scan_failed", { error: (e as Error).message }); return { error: "ALERT_SCAN_FAILED" }; });
    logEvent("info", "monitor.run", { trigger, ...summary });
    return NextResponse.json({ ...summary, agentAccounts: agents, walletAssociations: associations, paymentSchedules: schedules, alerts });
  } catch (e) {
    logEvent("error", "monitor.run_failed", { trigger, error: (e as Error).message });
    await new AlertService(await getDb()).raise({ kind: "MONITOR_RUN_FAILED", severity: "HIGH", dedupeKey: "monitor-run-failed", message: `Monitor run failed: ${(e as Error).message.slice(0, 200)}` }).catch(() => undefined);
    return NextResponse.json({ error: { code: "MONITOR_FAILED" } }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
