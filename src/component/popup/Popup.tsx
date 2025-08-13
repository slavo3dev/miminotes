/// <reference types="chrome" />
import { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import {
  loadAll,
  loadVideo,
  saveVideo,
  deleteVideo as removeVideo,
} from '../../helper/storage';
import type { MimiNote, MimiVideoData } from '../../helper/storage';

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

const parseYouTubeId = (url: string): string | null =>
  url.match(/[?&]v=([\w-]{11})/)?.[1] ||
  url.match(/youtu\.be\/([\w-]{11})/)?.[1] ||
  url.match(/embed\/([\w-]{11})/)?.[1] ||
  null;

export const Popup = () => {
  const [note, setNote] = useState('');
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [videoId, setVideoId] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [notes, setNotes] = useState<MimiNote[]>([]);
  const [allVideos, setAllVideos] = useState<Record<string, MimiVideoData>>({});
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      const allRaw = await loadAll();
      const all = Object.fromEntries(
        Object.entries(allRaw).map(([k, v]) => [k, ensureVideoData(v)])
      );
      setAllVideos(all);

      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const url = tabs[0]?.url || '';
        const ytId = parseYouTubeId(url);
        if (!ytId) return;

        setVideoId(ytId);
        setActiveVideoId(ytId);

        const dataRaw = all[ytId] ?? (await loadVideo(ytId));
        const data = dataRaw ? ensureVideoData(dataRaw) : null;

        if (data) {
          setVideoTitle(data.title);
          setNotes(Array.isArray(data.notes) ? data.notes : []);
        } else {
          setVideoTitle('');
          setNotes([]);
        }
      });
    })();
  }, []);

  // Live sync with chrome.storage
  useEffect(() => {
    const handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] = async (changes, area) => {
      if (area !== 'local') return;
      if (!Object.keys(changes).some((k) => k.startsWith('mimi_'))) return;

      const allRaw = await loadAll();
      const all = Object.fromEntries(
        Object.entries(allRaw).map(([k, v]) => [k, ensureVideoData(v)])
      );
      setAllVideos(all);

      if (activeVideoId) {
        const dataRaw = await loadVideo(activeVideoId);
        const data = dataRaw ? ensureVideoData(dataRaw) : null;
        if (data) {
          setVideoTitle(data.title);
          setNotes(Array.isArray(data.notes) ? data.notes : []);
        }
      }
    };

    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, [activeVideoId]);

  const handleSelectVideo = async (id: string) => {
    const dataRaw = allVideos[id] ?? (await loadVideo(id));
    const data = dataRaw ? ensureVideoData(dataRaw) : null;
    if (data) {
      setActiveVideoId(id);
      setVideoTitle(data.title);
      setNotes(Array.isArray(data.notes) ? data.notes : []);
    }
  };

  const handleDeleteVideoById = async (id: string) => {
    // stop if deleting current active video
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

  const handleAddNote = async () => {
    if (currentTime == null || !activeVideoId || !note.trim()) return;

    const newNote: MimiNote = {
      id: uuid(),
      createdAt: Date.now(),
      time: currentTime,
      text: note.trim(),
      videoId: activeVideoId,
    };

    const updatedNotes = [...notes, newNote].sort((a, b) => b.time - a.time);
    const updated: MimiVideoData = { title: videoTitle, notes: updatedNotes };

    setNotes(updatedNotes);
    setAllVideos({ ...allVideos, [activeVideoId]: updated });
    await saveVideo(activeVideoId, updated);

    setNote('');
  };

  const handleDeleteNote = async (index: number) => {
    if (!activeVideoId) return;

    const updatedNotes = notes.filter((_, i) => i !== index);
    const updated: MimiVideoData = { title: videoTitle, notes: updatedNotes };

    setNotes(updatedNotes);
    setAllVideos({ ...allVideos, [activeVideoId]: updated });
    await saveVideo(activeVideoId, updated);
  };

  const handleDeleteVideo = async () => {
    if (!activeVideoId) return;

    const next = { ...allVideos };
    delete next[activeVideoId];
    setAllVideos(next);

    await removeVideo(activeVideoId);

    setNotes([]);
    setVideoTitle('');
    setActiveVideoId(null);
  };

  const handleExport = () => {
    if (!activeVideoId) return;
    const blob = new Blob(
      [JSON.stringify({ videoTitle, notes }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    chrome.downloads?.download?.({
      url,
      filename: `${videoTitle || activeVideoId}_mimi_notes.json`,
      saveAs: true,
    });
  };

  const handleExportPDF = () => {
    if (!activeVideoId) return;
    const doc = new jsPDF();
    doc.text(videoTitle || 'Mimi Notes', 10, 10);
    notes.forEach((n, i) => {
      doc.text(`${formatTime(n.time)} – ${n.text}`, 10, 20 + i * 10);
    });
    doc.save(`${videoTitle || activeVideoId}_notes.pdf`);
  };

  const handleGetTimestamp = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => {
            const video = document.querySelector('video') as HTMLVideoElement | null;
            return video ? Math.floor(video.currentTime) : null;
          },
        },
        (results) => {
          const result = results?.[0]?.result;
          if (typeof result === 'number') setCurrentTime(result);
        }
      );
    });
  };

  const jumpTo = (sec: number) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      chrome.scripting.executeScript({
        target: { tabId },
        func: (time: number) => {
          const video = document.querySelector('video') as HTMLVideoElement | null;
          if (video) video.currentTime = time;
        },
        args: [sec],
      });
    });
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const toggleStickyNote = () => {
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

  // ---------- UI (classy black & white) ----------
  return (
    <div className="w-[360px] max-h-[560px] overflow-auto rounded-2xl bg-[#0b0b0b] text-zinc-200 shadow-2xl border border-zinc-800 p-4">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-wide text-zinc-100">MimiNotes</h1>
        <p className="text-xs text-zinc-400 mt-1">timestamped notes for YouTube</p>
      </header>

      <section className="mb-5">
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

      {activeVideoId && (
        <>
          {/* Title field */}
          <div className="mb-3">
            <label className="text-xs text-zinc-400 mb-1 block">Video title</label>
            <input
              value={videoTitle}
              onChange={async (e) => {
                if (!activeVideoId) return;
                const nextTitle = e.target.value;
                setVideoTitle(nextTitle);
                const updated: MimiVideoData = { title: nextTitle, notes };
                setAllVideos({ ...allVideos, [activeVideoId]: updated });
                await saveVideo(activeVideoId, updated);
              }}
              placeholder="Add a title…"
              className="w-full rounded-lg bg-zinc-900/70 border border-zinc-700 focus:border-zinc-500 focus:outline-none text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2"
            />
            <a
              href={`https://www.youtube.com/watch?v=${activeVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs underline decoration-zinc-600 underline-offset-4 text-zinc-300 hover:text-zinc-100 hover:decoration-zinc-300"
            >
              ▶ open on YouTube
            </a>
          </div>

          {/* Timestamp + note input */}
          <div className="mb-2 grid grid-cols-[1fr,110px] gap-2">
              <textarea
                className="rounded-lg bg-zinc-900/70 border border-zinc-700 focus:border-zinc-500 focus:outline-none text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2 resize"
                rows={2}
                placeholder="Write your note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleGetTimestamp}
                  className="flex items-center justify-center h-9 rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-900 hover:border-zinc-600 transition text-sm"
                >
                  ⏱ 
                </button>
                <button
                  onClick={handleAddNote}
                  className="flex items-center justify-center h-9 rounded-lg border border-zinc-700 bg-zinc-100 text-black hover:bg-white transition text-sm font-medium"
                >
                  ➕ add
                </button>
              </div>
          </div>


          {currentTime !== null && (
            <div className="text-xs text-zinc-400 mb-3">
              current time: <span className="text-zinc-200">{formatTime(currentTime)}</span>
            </div>
          )}

          {/* Exports & delete all */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              onClick={handleExport}
              className="rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:border-zinc-600 transition text-xs py-2"
            >
              ⬇ JSON
            </button>
            <button
              onClick={handleExportPDF}
              className="rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:border-zinc-600 transition text-xs py-2"
            >
              📝 PDF
            </button>
            <button
              onClick={handleDeleteVideo}
              className="rounded-lg border border-zinc-800 bg-red-600/80 text-white hover:bg-red-600 transition text-xs py-2"
            >
              🗑 clear all
            </button>
          </div>

          {/* Notes list */}
          <h2 className="text-sm font-medium text-zinc-300 mb-2">Notes</h2>
          {notes.length === 0 ? (
            <p className="text-xs text-zinc-500 mb-2">No notes yet.</p>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {notes.map((n, i) => (
                <li
                  key={n.id || i}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900/70 px-3 py-2"
                >
                  <button
                    onClick={() => jumpTo(n.time)}
                    className="text-left flex-1 text-zinc-200 hover:text-white transition"
                    title={new Date(n.createdAt).toLocaleString()}
                  >
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 mr-2">
                      {formatTime(n.time)}
                    </span>
                    {n.text}
                  </button>

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

          <button
            onClick={toggleStickyNote}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-900 hover:border-zinc-600 transition text-sm py-2.5"
          >
            📝 show sticky note
          </button>
        </>
      )}
    </div>
  );
};
