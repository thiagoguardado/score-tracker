import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = EventTarget & { released: boolean; release: () => Promise<void> };

export function useWakeLock(enabled: boolean) {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const [active, setActive] = useState(false);
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  const release = useCallback(async () => {
    await sentinel.current?.release().catch(() => undefined);
    sentinel.current = null;
    setActive(false);
  }, []);

  const request = useCallback(async () => {
    if (!enabled || !supported || document.visibilityState !== "visible") return;
    if (sentinel.current && !sentinel.current.released) return;
    try {
      const wakeLock = (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
      sentinel.current = await wakeLock.request("screen");
      setActive(true);
      sentinel.current.addEventListener("release", () => setActive(false), { once: true });
    } catch {
      setActive(false);
    }
  }, [enabled, supported]);

  useEffect(() => {
    if (enabled) void request();
    else void release();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && enabled) void request();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void release();
    };
  }, [enabled, release, request]);

  return { supported, active, request };
}
