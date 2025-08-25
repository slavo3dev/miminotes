/// <reference types="chrome" />
import { useEffect, useState, useRef } from 'react';
import jsPDF from 'jspdf';
import {
  loadAll,
  loadVideo,
  saveVideo,
  deleteVideo as removeVideo,
} from '../../helper/storage';
import type { MimiNote, MimiVideoData } from '../../helper/storage';
// ANALYTICS
import {
  trackPopupOpened,
  trackNoteAdded,
  trackExport,
  trackNoteDeleted,
  trackNotesCleared,
  trackStickyToggle,
} from '../../analytics/analytics';

// ---------- helpers: migration & utils ----------
const uuid = () =>
  (crypto as any)?.randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

const ensureNoteShape = (n: any): MimiNote => ({
  id: n?.id ?? uuid(),
  createdAt: n?.createdAt ?? Date.now(),
  time: Number(n?.time ?? 0),
  text: String(n?.text ?? ''),
  videoId: String(n?.videoId ?? ''),
});

const ensureVideoData = (data: any): MimiVideoData => ({
  title: typeof data?.title === 'string' ? data.title : '',
  notes: Array.isArray(data?.notes) ? data.notes.map(ensureNoteShape) : [],
});

// [TYPE-FIX] Parse string/unknown → MimiVideoData | null
const toVideoData = (raw: unknown): MimiVideoData | null => {
  if (raw == null) return null;
  let obj: any = raw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  return ensureVideoData(obj);
};

// [TYPE-FIX] Normalize loadAll() which may contain string values
const normalizeAll = (allRaw: Record<string, unknown>): Record<string, MimiVideoData> => {
  const out: Record<string, MimiVideoData> = {};
  for (const [k, v] of Object.entries(allRaw)) {
    const vd = toVideoData(v);
    if (vd) out[k] = vd;
  }
  return out;
};

const parseYouTubeId = (url: string): string | null =>
  url.match(/[?&]v=([\w-]{11})/)?.[1] ||
  url.match(/youtu\.be\/([\w-]{11})/)?.[1] ||
  url.match(/embed\/([\w-]{11})/)?.[1] ||
  null;

const urlMatchesVideoId = (url: string, id: string) => {
  const idInUrl = parseYouTubeId(url);
  return idInUrl === id;
};

// Query the active tab’s title (og:title → <h1> → document.title without " - YouTube")
const fetchTitleFromActiveTab = async (): Promise<string> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return resolve('');

      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => {
            try {
              const og = document
                .querySelector('meta[property="og:title"]')
                ?.getAttribute('content');
              const h1 =
                (document.querySelector('h1.ytd-watch-metadata') as HTMLElement | null)?.innerText?.trim() ||
                (document.querySelector('h1.title') as HTMLElement | null)?.innerText?.trim() ||
                (document.querySelector('h1') as HTMLElement | null)?.innerText?.trim();
              const doc = (document.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
              return og || h1 || doc || '';
            } catch {
              return '';
            }
          },
        },
        (results) => {
          const result = results?.[0]?.result;
          resolve(typeof result === 'string' ? result : '');
        }
      );
    });
  });
};

// [AUTO-TIMESTAMP] Get current time directly on demand (no separate button in UI)
const getCurrentVideoTime = async (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return resolve(null);
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => {
            const video = document.querySelector('video') as HTMLVideoElement | null;
            return video ? Math.floor(video.currentTime) : null;
          },
        },
        (results) => resolve((results?.[0]?.result as number) ?? null)
      );
    });
  });
};

// [NO-AUTOSAVE] Only persist title if the video already has notes stored.
// Otherwise, just return the detected title to show in UI without saving.
const ensureVideoTitle = async (
  videoId: string,
  currentTitle: string,
  hasNotes: boolean
): Promise<string> => {
  const base = currentTitle?.trim() ?? '';
  if (base) return base;

  const detected = (await fetchTitleFromActiveTab())?.trim();
  if (!detected) return base; // nothing we can do

  if (!hasNotes) {
    // Do NOT save if there are zero notes.
    return detected;
  }

  // Persist (only when notes exist)
  const dataRaw = await loadVideo(videoId);
  const data = toVideoData(dataRaw) ?? { title: '', notes: [] };
  const updated: MimiVideoData = { ...data, title: detected };
  await saveVideo(videoId, updated);
  return detected;
};

export const Popup = () => {
  const [note, setNote] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [notes, setNotes] = useState<MimiNote[]>([]);
  const [allVideos, setAllVideos] = useState<Record<string, MimiVideoData>>({});
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [stickyOpen, setStickyOpen] = useState(false);

  // [AUTO-REFRESH] Track the active tab id for URL changes
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  // [BIGGER-NOTE] focus note editor on mount/new video
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      const raw = await loadAll();
      // [TYPE-FIX] normalize and then remove 0-note entries
      const all = Object.fromEntries(
        Object.entries(normalizeAll(raw)).filter(([, v]) => v.notes.length > 0) // [NO-AUTOSAVE]
      );
      setAllVideos(all);

      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];
        const url = tab?.url || '';
        const ytId = parseYouTubeId(url);
        if (!ytId) return;

        setActiveTabId(tab?.id ?? null);
        setActiveVideoId(ytId);

        // Prefer cache first, then storage
        const dataRaw = all[ytId] ?? (await loadVideo(ytId));
        const data = toVideoData(dataRaw);

        if (data?.notes?.length) {
          // Saved video (has notes)
          setVideoTitle(data.title);
          setNotes(data.notes);
        } else {
          // Unsaved (0 notes) – show empty notes but auto-fill title in UI
          setNotes([]);
          const auto = await ensureVideoTitle(ytId, '', false /* hasNotes */);
          setVideoTitle(auto || '');
        }

        // [BIGGER-NOTE]
        setTimeout(() => noteRef.current?.focus(), 0);
      });
    })();
  }, []);

  useEffect(() => {
    void trackPopupOpened('popup');
  }, []);

  // Live sync with chrome.storage (but keep 0-note entries out)
  useEffect(() => {
    const handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] = async (changes, area) => {
      if (area !== 'local') return;
      if (!Object.keys(changes).some((k) => k.startsWith('mimi_'))) return;

      const raw = await loadAll();
      const normalized = normalizeAll(raw);
      const all = Object.fromEntries(
        Object.entries(normalized).filter(([, v]) => v.notes.length > 0) // [NO-AUTOSAVE]
      );
      setAllVideos(all);

      if (activeVideoId) {
        const dataRaw = await loadVideo(activeVideoId);
        const data = toVideoData(dataRaw);

        if (data?.notes?.length) {
          setVideoTitle(data.title);
          setNotes(data.notes);
        } else {
          // Active video has no saved notes; keep UI state (title may be auto)
          setNotes([]);
        }
      }
    };

    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, [activeVideoId]);

  // [AUTO-REFRESH] React to SPA URL changes on the active tab
  useEffect(() => {
    if (activeTabId == null) return;

    const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = async (tabId, changeInfo) => {
      if (tabId !== activeTabId) return;

      if (typeof changeInfo.url === 'string') {
        const newId = parseYouTubeId(changeInfo.url);
        if (!newId) return;

        setActiveVideoId(newId);

        // Load from storage
        const dataRaw = await loadVideo(newId);
        const data = toVideoData(dataRaw);

        if (data?.notes?.length) {
          setNotes(data.notes);
          const auto = await ensureVideoTitle(newId, data.title ?? '', true /* hasNotes */);
          setVideoTitle(auto || data.title || '');
          setAllVideos((prev) => ({ ...prev, [newId]: { title: auto || data.title || '', notes: data.notes } }));
        } else {
          setNotes([]);
          const auto = await ensureVideoTitle(newId, '', false /* hasNotes */);
          setVideoTitle(auto || '');
        }

        // [BIGGER-NOTE]
        setTimeout(() => noteRef.current?.focus(), 0);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => chrome.tabs.onUpdated.removeListener(onUpdated);
  }, [activeTabId]);

  const handleSelectVideo = async (id: string) => {
    const dataRaw = allVideos[id] ?? (await loadVideo(id));
    const data = toVideoData(dataRaw);

    setActiveVideoId(id);

    if (data?.notes?.length) {
      setVideoTitle(data.title);
      setNotes(data.notes);
      const auto = await ensureVideoTitle(id, data.title ?? '', true);
      if (auto && auto !== data.title) {
        setVideoTitle(auto);
        setAllVideos((prev) => ({ ...prev, [id]: { title: auto, notes: data.notes } }));
      }
    } else {
      setNotes([]);
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const url = tabs[0]?.url || '';
        if (url && urlMatchesVideoId(url, id)) {
          const auto = await ensureVideoTitle(id, '', false);
          setVideoTitle(auto || '');
        } else {
          setVideoTitle('');
        }
      });
    }

    // [BIGGER-NOTE]
    setTimeout(() => noteRef.current?.focus(), 0);
  };

  const handleDeleteVideoById = async (id: string) => {
    await removeVideo(id);
    const next = { ...allVideos };
    delete next[id];
    setAllVideos(next);

    if (activeVideoId === id) {
      setNotes([]);
      setVideoTitle('');
      setActiveVideoId(null);
    }
  };

  // [AUTO-TIMESTAMP] + [KEYBINDINGS] add note; timestamp pulled automatically
  const addNoteInternal = async () => {
    if (!activeVideoId || !note.trim()) return;

    const timeNow = (await getCurrentVideoTime()) ?? 0;

    const newNote: MimiNote = {
      id: uuid(),
      createdAt: Date.now(),
      time: timeNow,
      text: note.trim(),
      videoId: activeVideoId,
    };

    const updatedNotes = [...notes, newNote].sort((a, b) => b.time - a.time);

    // First note creates/persists the video entry with title
    const updated: MimiVideoData = {
      title: videoTitle || (await fetchTitleFromActiveTab()) || '',
      notes: updatedNotes,
    };

    setNotes(updatedNotes);
    setAllVideos((prev) => ({ ...prev, [activeVideoId]: updated }));
    await saveVideo(activeVideoId, updated);

    void trackNoteAdded({
      videoId: activeVideoId,
      timeSec: timeNow,
      length: newNote.text.length,
    });

    setNote('');
    setTimeout(() => noteRef.current?.focus(), 0);
  };

  const handleDeleteNote = async (index: number) => {
    if (!activeVideoId) return;

    const updatedNotes = notes.filter((_, i) => i !== index);

    if (updatedNotes.length === 0) {
      // [NO-AUTOSAVE] If last note removed, delete the whole video (no empty videos)
      await removeVideo(activeVideoId);
      const next = { ...allVideos };
      delete next[activeVideoId];
      setAllVideos(next);
      setNotes([]);
    } else {
      const updated: MimiVideoData = { title: videoTitle, notes: updatedNotes };
      setNotes(updatedNotes);
      setAllVideos((prev) => ({ ...prev, [activeVideoId]: updated }));
      await saveVideo(activeVideoId, updated);
    }

    void trackNoteDeleted(activeVideoId);
  };

  const handleDeleteVideo = async () => {
    if (!activeVideoId) return;

    // [DESTRUCTIVE-SAFE] Confirm and keep button subtle elsewhere
    const ok = window.confirm('Delete all notes for this video? This cannot be undone.');
    if (!ok) return;

    const next = { ...allVideos };
    delete next[activeVideoId];
    setAllVideos(next);

    await removeVideo(activeVideoId);
    void trackNotesCleared(activeVideoId);

    setNotes([]);
  };

  const handleExportPDF = () => {
    if (!activeVideoId || notes.length === 0) return; // [REMOVE-JSON] & guard

    const doc = new jsPDF();
    doc.text(videoTitle || 'Mimi Notes', 10, 10);
    notes.forEach((n, i) => {
      doc.text(`${formatTime(n.time)} – ${n.text}`, 10, 20 + i * 10);
    });
    doc.save(`${videoTitle || activeVideoId}_notes.pdf`);

    void trackExport('pdf', activeVideoId);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const toggleStickyNote = () => {
    const nextOpen = !stickyOpen;
    setStickyOpen(nextOpen);
    if (activeVideoId) {
      void trackStickyToggle(activeVideoId, nextOpen);
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_MIMI_NOTE' }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript(
            { target: { tabId }, files: ['content.js'] },
            () => chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_MIMI_NOTE' })
          );
        }
      });
    });
  };

  // Manual title refresh (never saves if 0 notes)
  const handleAutoFillTitle = async () => {
    if (!activeVideoId) return;
    const auto = await ensureVideoTitle(activeVideoId, videoTitle, notes.length > 0);
    if (auto && auto !== videoTitle) {
      setVideoTitle(auto);
      if (notes.length > 0) {
        const updated: MimiVideoData = { title: auto, notes };
        setAllVideos((prev) => ({ ...prev, [activeVideoId]: updated }));
        await saveVideo(activeVideoId, updated);
      }
    }
  };

  // ---------- UI (refined) ----------
  return (
    <div className="w-[360px] max-h-[560px] overflow-auto rounded-2xl bg-[#0b0b0b] text-zinc-200 shadow-2xl border border-zinc-800 p-4">
      {/* Top bar: Sticky + PDF ———— */}
      <div className="mb-3 flex items-center justify-between">
        {/* [MOVE-STICKY] */}
        <button
          onClick={toggleStickyNote}
          className="rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-900 hover:border-zinc-600 transition text-sm px-3 py-2"
          title="Show sticky note overlay on the video"
        >
          📝 Sticky notes
        </button>

        {/* [PDF-IN-HEADER] tiny, secondary */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportPDF}
            disabled={notes.length === 0}
            className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-zinc-500 hover:bg-zinc-900 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={notes.length === 0 ? 'Add a note first' : 'Export all notes to PDF'}
          >
            📝 PDF
          </button>
        </div>
      </div>

      <header className="mb-3">
        <h1 className="text-lg font-semibold tracking-wide text-zinc-100">MimiNotes</h1>
        <p className="text-[11px] text-zinc-400 mt-0.5">Timestamped notes for YouTube</p>
      </header>

      {/* Saved videos ———— */}
      <section className="mb-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-2">📁 Saved videos</h2>
        {Object.keys(allVideos).length === 0 ? (
          <p className="text-xs text-zinc-500">No videos saved yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {Object.entries(allVideos).map(([id, data]) => {
              const isActive = id === activeVideoId;
              return (
                <li
                  key={id}
                  onClick={() => handleSelectVideo(id)}
                  className={`group flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition
                    ${isActive ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50'}
                    cursor-pointer`}
                  title={data.title || 'Untitled'}
                >
                  <div className="min-w-0">
                    <a
                      href={`https://www.youtube.com/watch?v=${id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={`truncate underline decoration-zinc-600 underline-offset-4 hover:decoration-zinc-300
                        ${isActive ? 'text-zinc-100' : 'text-zinc-200 hover:text-zinc-100'}`}
                    >
                      {data.title || 'Untitled'}
                    </a>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {data.notes.length} note{data.notes.length !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteVideoById(id);
                    }}
                    aria-label="Delete saved video"
                    className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 transition"
                    title="Delete saved video"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Title (read-only) ———— */}
      {activeVideoId && (
        <>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-400">Video title</label>
              <button
                onClick={handleAutoFillTitle}
                className="text-[11px] px-2 py-0.5 rounded-md border border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:text-white hover:border-zinc-500 hover:bg-zinc-900 transition"
                title="Re-detect from active tab"
              >
                ↻ auto-fill
              </button>
            </div>

            <div className="w-full rounded-lg bg-zinc-900/70 border border-zinc-700 text-sm text-zinc-100 px-3 py-2">
              {videoTitle || 'Detecting…'}
            </div>

            <a
              href={`https://www.youtube.com/watch?v=${activeVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs underline decoration-zinc-600 underline-offset-4 text-zinc-300 hover:text-zinc-100 hover:decoration-zinc-300"
            >
              ▶ open on YouTube
            </a>
          </div>

          {/* New Note ———— */}
          <div className="mb-3">
            {/* bigger editor stays the same */}
            <textarea
              ref={noteRef}
              className="w-full rounded-xl bg-zinc-900/70 border border-zinc-700 focus:border-zinc-500 focus:outline-none text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2 resize min-h-[120px]"
              placeholder="Write your note… (Tip: ⌘/Ctrl + Enter to add)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={async (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  await addNoteInternal();
                }
              }}
            />

            {/* [CTA-IMPROVE] full-width primary button, no overlap, with shortcut hint */}
            <button
              onClick={addNoteInternal}
              disabled={!note.trim()}
              title={!note.trim() ? 'Type a note to enable' : 'Add note (⌘/Ctrl + Enter)'}
              className={[
                "group relative mt-3 w-full h-11",
                "rounded-xl border border-zinc-700 bg-zinc-100 text-zinc-900",
                "font-medium shadow-sm",
                "hover:bg-white active:scale-[0.99] transition",
                "focus:outline-none focus:ring-2 focus:ring-zinc-500/50",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              ].join(' ')}
            >
              {/* left icon */}
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">＋</span>
              {/* label */}
              <span className="text-sm">Add note</span>
              {/* right shortcut hint */}
              <kbd
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] px-1.5 py-0.5 rounded-md border border-zinc-400/60 text-zinc-700 bg-white/70 group-hover:bg-white"
                aria-hidden
              >
                ⌘/Ctrl + ↵
              </kbd>
            </button>

            {/* tiny helper text under button */}
            <div className="mt-2 text-[11px] text-zinc-500">
              Timestamps are captured automatically from the video.
            </div>
          </div>

          {/* Notes list ———— */}
          <h2 className="text-sm font-medium text-zinc-300 mb-2">Notes</h2>
          {notes.length === 0 ? (
            <p className="text-xs text-zinc-500 mb-2">No notes yet.</p>
          ) : (
            <ul className="space-y-1.5 mb-2">
              {notes.map((n, i) => (
                <li
                  key={n.id || i}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900/70 px-3 py-2"
                >
                  <div className="text-left flex-1 text-zinc-200">
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 mr-2">
                      {formatTime(n.time)}
                    </span>
                    {n.text}
                  </div>

                  <button
                    onClick={() => handleDeleteNote(i)}
                    className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 transition"
                    aria-label="Delete note"
                    title="Delete note"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* [DESTRUCTIVE-SAFE] subtle, after list */}
          <div className="mt-1 mb-3">
            <button
              onClick={handleDeleteVideo}
              className="text-[11px] text-red-400 hover:text-red-300 underline underline-offset-4 decoration-red-500/60"
              disabled={notes.length === 0}
              title={notes.length === 0 ? 'No saved notes to clear' : 'Delete all notes for this video'}
            >
              Clear all notes
            </button>
          </div>
        </>
      )}
    </div>
  );
};
