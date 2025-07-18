/// <reference types="chrome" />
import { useEffect, useState } from 'react';
import jsPDF from 'jspdf';

interface Note {
  time: number;
  text: string;
  videoId: string;
}

interface VideoData {
  title: string;
  notes: Note[];
}

export const Popup = () => {
  const [note, setNote] = useState('');
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [videoId, setVideoId] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [allVideos, setAllVideos] = useState<Record<string, VideoData>>({});
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  useEffect(() => {
    const all: Record<string, VideoData> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mimi_')) {
        const data = localStorage.getItem(key);
        if (data) {
          all[key.replace('mimi_', '')] = JSON.parse(data);
        }
      }
    }
    setAllVideos(all);


    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab.url) return;
      const match = tab.url.match(/v=([\w-]+)/);
      if (match) {
        const id = match[1];
        setVideoId(id);
        setActiveVideoId(id);
        const data = all[id];
        if (data) {
          setVideoTitle(data.title || '');
          setNotes(data.notes || []);
        }
      }
    });
  }, []);

  const handleSelectVideo = (id: string) => {
    const data = allVideos[id];
    if (data) {
      setActiveVideoId(id);
      setVideoTitle(data.title);
      setNotes(data.notes);
    }
  };

  const handleAddNote = () => {
    if (!currentTime || !activeVideoId || !note.trim()) return;
    const newNote: Note = { time: currentTime, text: note.trim(), videoId: activeVideoId };
    const updatedNotes = [...notes, newNote].sort((a, b) => b.time - a.time);
    const updated = { title: videoTitle, notes: updatedNotes };
    setNotes(updatedNotes);
    setAllVideos({ ...allVideos, [activeVideoId]: updated });
    localStorage.setItem(`mimi_${activeVideoId}`, JSON.stringify(updated));

    setNote('');
  };

  const handleDeleteNote = (index: number) => {
    if (!activeVideoId) return;
    const updatedNotes = notes.filter((_, i) => i !== index);
    const updated = { title: videoTitle, notes: updatedNotes };
    setNotes(updatedNotes);
    setAllVideos({ ...allVideos, [activeVideoId]: updated });
    localStorage.setItem(`mimi_${activeVideoId}`, JSON.stringify(updated));

  };

  const handleDeleteVideo = () => {
    if (!activeVideoId) return;
    const updatedVideos = { ...allVideos };
    delete updatedVideos[activeVideoId];
    localStorage.removeItem(`mimi_${activeVideoId}`);
    setAllVideos(updatedVideos);
    setNotes([]);
    setVideoTitle('');
    setActiveVideoId(null);
  };

  const handleExport = () => {
    if (!activeVideoId) return;
    const blob = new Blob([JSON.stringify({ videoTitle, notes }, null, 2)], {
      type: 'application/json',
    });
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
    doc.text(videoTitle || "Mimi Notes", 10, 10);
    notes.forEach((note, i) => {
      doc.text(`${formatTime(note.time)} – ${note.text}`, 10, 20 + i * 10);
    });
    doc.save(`${videoTitle || activeVideoId}_notes.pdf`);
  };

  const handleGetTimestamp = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0].id) return;
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          func: () => {
            const video = document.querySelector('video');
            return video ? Math.floor(video.currentTime) : null;
          },
        },
        (results) => {
          const result = results?.[0]?.result;
          if (typeof result === 'number') {
            setCurrentTime(result);
          }
        }
      );
    });
  };

  const jumpTo = (sec: number) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0].id) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (time: number) => {
          const video = document.querySelector('video');
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
    console.log("Pressed toggleStickyNote");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0].id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_MIMI_NOTE' });
    });
};

  return (
    <div className="p-3 w-[300px] text-sm resize overflow-auto">
      <h1 className="text-lg font-bold mb-2">MimiNotes</h1>

      <div className="mb-4">
        <h2 className="font-semibold mb-1">📁 Your Saved Videos:</h2>
        {Object.entries(allVideos).length === 0 && (
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
            onChange={(e) => {
              setVideoTitle(e.target.value);
              const updated = { title: e.target.value, notes };
              setAllVideos({ ...allVideos, [activeVideoId]: updated });
              localStorage.setItem(`mimi_${activeVideoId}`, JSON.stringify(updated));

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
              <li key={i} className="flex justify-between items-center text-sm">
                <span
                  onClick={() => jumpTo(n.time)}
                  className="text-blue-600 hover:underline cursor-pointer"
                >
                  {formatTime(n.time)} – {n.text}
                </span>
                <button
                  onClick={() => handleDeleteNote(i)}
                  className="ml-2 text-red-500 hover:text-red-700"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button onClick={toggleStickyNote} className="bg-blue-700 text-white px-2 py-1 rounded mb-2 w-full">
            📝 Show Sticky Note
          </button>
        </>
      )}
    </div>
  );
};
