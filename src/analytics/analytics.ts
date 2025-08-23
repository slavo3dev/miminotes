/// <reference types="chrome" />

/**
 * Public helper for sending Google Analytics events from popup/content.
 * Events are relayed to the background service worker, which posts to GA.
 *
 * Usage:
 *   import { trackEvent, trackNoteAdded } from "@/analytics/analytics";
 *   await trackEvent("popup_opened");
 *   await trackNoteAdded({ videoId, length: note.length });
 */

export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

export type TrackOptions = {
  /** If true and background is sleeping, we'll fail fast (default true). */
  failFast?: boolean;
  /** Optional timeout (ms) for sendMessage; default 1500ms. */
  timeoutMs?: number;
};

// You can toggle analytics globally at build-time if desired
const ENABLE_ANALYTICS =
  (import.meta as any)?.env?.VITE_ENABLE_ANALYTICS !== "false";

/** Core: send a GA event via background SW (which calls Measurement Protocol). */
export function trackEvent(
  name: string,
  params: AnalyticsParams = {},
  opts: TrackOptions = {}
): Promise<boolean> {
  if (!ENABLE_ANALYTICS) return Promise.resolve(false);

  const { failFast = true, timeoutMs = 1500 } = opts;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(
        { type: "GA_EVENT", name, params },
        (resp?: { ok?: boolean; error?: string }) => {
          if (settled) return;
          window.clearTimeout(timer);

          // If the background is not ready / SW asleep, lastError is set.
          const lastErr = chrome.runtime.lastError?.message;
          if (lastErr) {
            // Optionally retry here (we keep it simple & fail-fast by default).
            if (failFast) {
              settled = true;
              return resolve(false);
            }
          }

          settled = true;
          resolve(Boolean(resp?.ok));
        }
      );
    } catch {
      if (!settled) {
        window.clearTimeout(timer);
        settled = true;
        resolve(false);
      }
    }
  });
}

/* --------------------------
 * Convenience wrappers
 * -------------------------- */

/** When popup becomes visible. */
export const trackPopupOpened = (where: "popup" | "options" = "popup") =>
  trackEvent("popup_opened", { where });

/** When user opens/closes sticky note UI on a video. */
export const trackStickyToggle = (videoId: string, visible: boolean) =>
  trackEvent("sticky_toggle", { videoId, visible });

/** When a note is added. */
export const trackNoteAdded = (args: {
  videoId: string;
  timeSec: number;
  length: number;
}) =>
  trackEvent("note_added", {
    videoId: args.videoId,
    timeSec: args.timeSec,
    length: args.length,
  });

/** When a note is deleted. */
export const trackNoteDeleted = (videoId: string) =>
  trackEvent("note_deleted", { videoId });

/** When all notes for a video are cleared. */
export const trackNotesCleared = (videoId: string) =>
  trackEvent("notes_cleared", { videoId });

/** When user exports notes. */
export const trackExport = (format: "json" | "pdf", videoId?: string) =>
  trackEvent("export", { format, videoId });

/** When user updates the video title. */
export const trackTitleEdited = (videoId: string) =>
  trackEvent("title_edited", { videoId });

/** Generic error tracking (no PII!) */
export const trackError = (context: string, code?: string) =>
  trackEvent("error", { context, code });

/* --------------------------
 * Small niceties
 * -------------------------- */

/** Debounced tracker for bursty events (e.g., typing-based). */
export function createDebouncedTracker(
  name: string,
  delayMs = 400
): (params?: AnalyticsParams) => void {
  let t: number | undefined;
  return (params?: AnalyticsParams) => {
    window.clearTimeout(t);
    // @ts-ignore
    t = window.setTimeout(() => void trackEvent(name, params), delayMs);
  };
}
