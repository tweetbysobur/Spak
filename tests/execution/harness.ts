import { AuthService } from "@/auth/service";
import { PgAuditLog, PgIntentLog, PgSessionStore, type Db } from "@/database/repositories";
import { OneClickClient } from "@/integrations/near-intents/client";
import { ExecutionRecords, ExecutionService, IntentLogPlanStore, type VerifiedWallet } from "@/execution";
import { SpakIn } from "@/spak-in";
import { freshDb } from "../auth/db";
import { evmWallet, nearWallet, solanaWallet } from "../auth/keys";
import { DepositRecords, DepositService } from "@/deposits";
import { FakeChain } from "../deposits/fake-chain";
import { DestinationVerifier, ExecutionMonitor, TrackingRecords, TrackingService } from "@/tracking";
import { Fake1Click } from "./fake-1click";

export const T0 = Date.parse("2026-11-10T10:00:00Z");

/** A real user (signed in with real keys) with a verified EVM and Solana wallet, real SPak-in, mocked 1Click. */
export async function harness(opts: { client?: OneClickClient } = {}) {
  const db: Db = await freshDb();
  const clock = { now: T0 };
  const now = () => new Date(clock.now);
  const auth = new AuthService(db, { clock: now, nearRpc: { accessKey: async () => null } });
  const intentLog = new PgIntentLog(db);
  const spakIn = new SpakIn({ sessions: new PgSessionStore(db), clock: now, onResult: (r, req) => intentLog.record(r, req.userId ?? null) });
  const fake = new Fake1Click();
  const records = new ExecutionRecords(db, now);
  const svc = new ExecutionService({ client: opts.client ?? new OneClickClient({ fetchImpl: fake.fetch as typeof fetch }), records, plans: new IntentLogPlanStore(db), audit: new PgAuditLog(db), clock: now });

  const chain = new FakeChain();
  const depositRecords = new DepositRecords(db, now);
  const deposits = new DepositService({ records: depositRecords, executions: records, executionService: svc, rpc: chain, client: new OneClickClient({ fetchImpl: fake.fetch as typeof fetch }), audit: new PgAuditLog(db), clock: now });
  const tracking = new TrackingRecords(db, now);
  const destination = new DestinationVerifier({ executions: records, tracking, rpc: chain, audit: new PgAuditLog(db), clock: now });
  const monitor = new ExecutionMonitor({ tracking, executions: records, execution: svc, deposits, depositRecords, destination, clock: now });
  const trackingService = new TrackingService({ executions: records, execution: svc, tracking, depositRecords, destination });

  async function newUser() {
    const e = evmWallet(), s = solanaWallet();
    const c = await auth.createChallenge({ family: "evm", address: e.address, purpose: "SIGN_IN", domain: "spak.test", uri: "https://spak.test" });
    const { userId } = await auth.verifyChallenge({ challengeId: c.challengeId, signature: (await e.sign(c.message)).signature });
    const l = await auth.createChallenge({ family: "solana", address: s.address, purpose: "LINK", domain: "spak.test", uri: "https://spak.test", userId });
    await auth.verifyChallenge({ challengeId: l.challengeId, signature: (await s.sign(l.message)).signature, currentUserId: userId });
    const n = nearWallet();
    const nl = await auth.createChallenge({ family: "near", purpose: "LINK", domain: "spak.test", uri: "https://spak.test", userId });
    const ns = await n.sign(nl.message, Buffer.from(nl.nonce!, "base64").toString("hex"), nl.recipient!);
    await auth.verifyChallenge({ challengeId: nl.challengeId, signature: ns.signature, publicKey: ns.publicKey, accountId: n.address, currentUserId: userId });
    const wallets = async (): Promise<VerifiedWallet[]> => (await auth.listWallets(userId)).map((w) => ({ family: w.family, address: w.address, networks: w.networks }));
    const plan = async (text: string, sessionId = `s-${Math.random()}`) => {
      const r = await spakIn.interpret({ text, userId, sessionId, wallets: await auth.walletContext(userId), now: now().toISOString() });
      return r;
    };
    return { userId, evm: e, sol: s, near: n, wallets, plan };
  }
  return { db, clock, now, auth, spakIn, fake, svc, records, newUser, chain, deposits, depositRecords, tracking, destination, monitor, trackingService };
}

export const approval = (planHash: string, at: Date, allowDuplicate = false, planRevision = 0) => ({ planHash, planRevision, approvedAt: at.toISOString(), allowDuplicate });
