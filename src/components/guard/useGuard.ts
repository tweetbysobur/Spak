"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { guardApi, guardMessage, type GuardMessage, type GuardView } from "@/lib/guard";

export type LoadState = "loading" | "ready" | "unavailable" | "error";
/** Run a write. Resolves to null on success, or the message to show. */
export type Run = (write: (version: number) => Promise<GuardView>, success: string) => Promise<GuardMessage | null>;

/**
 * Guard data for one screen. The view only ever comes from a server response: after a write, the returned policy
 * replaces the old one. Nothing is shown as saved before the server confirms it. Every write sends the version of
 * the policy on screen; on a version conflict the latest policy is reloaded and the user saves again by hand.
 */
export function useGuard(onSaved?: (message: string) => void) {
  const [view, setView] = useState<GuardView | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string>();
  const viewRef = useRef<GuardView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    try {
      const v = await guardApi.get();
      setView(v); setState("ready"); setLoadError(undefined);
      return v;
    } catch (e) {
      const code = (e as { code?: string }).code;
      setState(code === "GUARD_UNAVAILABLE" || code === "PROVIDER_ERROR" ? "unavailable" : "error");
      setLoadError((e as Error).message);
      return null;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run: Run = useCallback(async (write, success) => {
    const current = viewRef.current;
    if (!current) return { title: "Guard settings are not loaded.", reasons: [] };
    try {
      setView(await write(current.policy.version));
      onSaved?.(success);
      return null;
    } catch (e) {
      const g = guardMessage(e) ?? { title: "The change was not saved.", reasons: [(e as Error).message] };
      if ((e as { code?: string }).code === "GUARD_VERSION_CONFLICT" || (e as { code?: string }).code === "GUARD_RECIPIENT_NOT_FOUND") await load();
      return g;
    }
  }, [load, onSaved]);

  return { view, state, loadError, load, run };
}
