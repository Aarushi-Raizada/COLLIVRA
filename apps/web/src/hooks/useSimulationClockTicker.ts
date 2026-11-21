"use client";

import { useEffect, useRef } from "react";
import { useZorbitStore } from "../store/useZorbitStore";

/**
 * Top-level authoritative ticker for the global simulation clock.
 * Mounted once at the application root to drive synchronized simulation time
 * without competing timers or duplicate animation frames.
 */
export function useSimulationClockTicker(): void {
  const isPlaying = useZorbitStore((s) => s.isPlaying);
  const stepClock = useZorbitStore((s) => s.stepSimulationClock);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      lastTimeRef.current = null;
      return;
    }

    let animId: number;

    const tick = (now: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = now;
      }
      const rawDeltaSec = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      // Cap delta time to 0.25s to avoid huge jumps on background tab resume
      const deltaSec = Math.min(rawDeltaSec, 0.25);
      if (deltaSec > 0) {
        stepClock(deltaSec);
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
      lastTimeRef.current = null;
    };
  }, [isPlaying, stepClock]);
}
