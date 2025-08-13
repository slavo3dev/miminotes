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

const parseYouTubeId = (url: string): string | null => {
  return (
    url.match(/[?&]v=([\w-]{11})/)?.[1] || // watch?v=
    url.match(/youtu\.be\/([\w-]{11})/)?.[1] || // youtu.be/ID
    url.match(/embed\/([\w-]{11})/)?.[1] || // /embed/ID
    null
  );
};

export const Popup = () => {
  const [note, setNote] = useState('');
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [videoId, setVideoId] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [notes, setNotes] = useState<MimiNote[]>([]);
  const [allVideos, setAllVideos] = useState<Record<string, MimiVideoData>>({});
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  // Initial load: all videos + detect current tab's YouTube videoId
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

  // Live sync: react to chrome.storage updates (from content script / another popup)
  useEffect(() => {
    const handler: Parameters<
      typeof chrome.storage.onChanged.addListener
    >[0] = async (changes, area) => {
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

  const handleAddNote = async () => {
    if (currentTime == null || !activeVideoId || !note.trim()) return; // allow time=0

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
    chrome.downloads.download({
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

  // const toggleStickyNote = () => {
  //   chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  //     const tabId = tabs[0]?.id;
  //     if (!tabId) return;
  //     chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_MIMI_NOTE' });
  //   });
  // };

const toggleStickyNote = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;

    const sendToggle = () =>
      chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_MIMI_NOTE' }, () => {
        if (chrome.runtime.lastError) {
          // No listener → inject, then retry
          chrome.scripting.executeScript(
            { target: { tabId }, files: ['content.js'] },
            () => chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_MIMI_NOTE' })
          );
        }
      });

    sendToggle();
  });
};


  return (
    <div className="p-3 w-[300px] text-sm resize overflow-auto">
      <h1 className="text-lg font-bold mb-2">MimiNotes</h1>

      <div className="mb-4">
        <h2 className="font-semibold mb-1">📁 Your Saved Videos:</h2>
        {Object.keys(allVideos).length === 0 && (
          <p className="text-xs text-gray-500">No videos saved yet.</p>
        )}
        <ul className="space-y-1">
          {Object.entries(allVideos).map(([id, data]) => (
            <li
              key={id}
              className={`cursor-pointer hover:underline ${
                id === activeVideoId ? 'text-blue-700 font-semibold' : 'text-blue-600'
              }`}
              onClick={() => handleSelectVideo(id)}
            >
              🔗 {data.title || 'Untitled'} ({data.notes.length})
            </li>
          ))}
        </ul>
      </div>

      {activeVideoId && (
        <>
          <a
            href={`https://www.youtube.com/watch?v=${activeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline mb-2 block"
          >
            ▶️ Open this video
          </a>

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
            placeholder="Video title..."
            className="w-full border text-sm p-1 rounded mb-2"
          />

          <button
            onClick={handleGetTimestamp}
            className="bg-blue-600 text-white px-2 py-1 rounded mb-2 w-full"
          >
            ⏱ Get Timestamp
          </button>

          {currentTime !== null && (
            <div className="text-sm mb-2">Current time: {formatTime(currentTime)}</div>
          )}

          <textarea
            className="w-full border rounded p-2 text-sm mb-2 resize"
            rows={2}
            placeholder="Write your note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <button
            onClick={handleAddNote}
            className="bg-green-600 text-white px-3 py-1 rounded w-full mb-2"
          >
            ➕ Add Note
          </button>

          <div className="flex gap-2 mb-4">
            <button
              onClick={handleExport}
              className="bg-yellow-500 text-white text-xs px-2 py-1 rounded w-full"
            >
              ⬇️ Export JSON
            </button>
            <button
              onClick={handleExportPDF}
              className="bg-purple-600 text-white text-xs px-2 py-1 rounded w-full"
            >
              📝 PDF
            </button>
            <button
              onClick={handleDeleteVideo}
              className="bg-red-600 text-white text-xs px-2 py-1 rounded w-full"
            >
              🗑 Delete All
            </button>
          </div>

          <h2 className="font-semibold text-sm mb-1">Notes:</h2>
          {notes.length === 0 && <p className="text-xs text-gray-500">No notes yet.</p>}
          <ul className="space-y-1">
            {notes.map((n, i) => (
              <li key={n.id || i} className="flex justify-between items-center text-sm">
                <span
                  onClick={() => jumpTo(n.time)}
                  className="text-blue-600 hover:underline cursor-pointer"
                  title={new Date(n.createdAt).toLocaleString()}
                >
                  {formatTime(n.time)} – {n.text}
                </span>
                <button
                  onClick={() => handleDeleteNote(i)}
                  className="ml-2 text-red-500 hover:text-red-700"
                  aria-label="Delete note"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={toggleStickyNote}
            className="bg-blue-700 text-white px-2 py-1 rounded mb-2 w-full"
          >
            📝 Show Sticky Note
          </button>
        </>
      )}
    </div>
  );
};
