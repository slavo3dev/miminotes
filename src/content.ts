/// <reference types="chrome" />

type MimiNote = { id: string; time: number; text: string; videoId: string; createdAt: number };
type MimiVideoData = { title: string; notes: MimiNote[] };

const key = (videoId: string) => `mimi_${videoId}`;
const posKey = (videoId: string) => `mimi_pos_${videoId}`;

async function loadVideo(videoId: string): Promise<MimiVideoData | null> {
  const result = await chrome.storage.local.get(key(videoId));
  return result[key(videoId)] ?? null;
}

 async function saveVideo(videoId: string, data: MimiVideoData): Promise<void> {
  await chrome.storage.local.set({ [key(videoId)]: data });
}

async function loadAll(): Promise<Record<string, MimiVideoData>> {
  const all = await chrome.storage.local.get(null);
  return Object.fromEntries(
    Object.entries(all)
      .filter(([k]) => k.startsWith('mimi_'))
      .map(([k, v]) => [k.replace('mimi_', ''), v as MimiVideoData])
  );
}

async function deleteVideo(videoId: string): Promise<void> {
  await chrome.storage.local.remove(key(videoId));
}


async function loadPosition(videoId: string): Promise<{ x: number; y: number }> {
  const k = posKey(videoId);
  const res = await chrome.storage.local.get(k);
  return res[k] ?? { x: 100, y: 100 };
}

async function savePosition(videoId: string, pos: { x: number; y: number }): Promise<void> {
  const k = posKey(videoId);
  await chrome.storage.local.set({ [k]: pos });
}

const NOTE_ID = 'mimi-draggable-note';
const STORAGE_KEY = (vid: string) => `mimi_${vid}`; // for storage change detection

// ---------- utils ----------
const uuid = () =>
  (crypto as any)?.randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

const ensureNote = (n: any): MimiNote => ({
  id: n?.id ?? uuid(),
  createdAt: n?.createdAt ?? Date.now(),
  time: Number(n?.time ?? 0),
  text: String(n?.text ?? ''),
  videoId: String(n?.videoId ?? ''),
});

const ensureVideoData = (d: any | null): MimiVideoData => ({
  title: d && typeof d.title === 'string' ? d.title : '',
  notes: Array.isArray(d?.notes) ? d.notes.map(ensureNote) : [],
});

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const parseYouTubeId = (url: string): string | null =>
  url.match(/[?&]v=([\w-]{11})/)?.[1] ||
  url.match(/youtu\.be\/([\w-]{11})/)?.[1] ||
  url.match(/embed\/([\w-]{11})/)?.[1] ||
  null;

const getVideoEl = () => document.querySelector('video') as HTMLVideoElement | null;

function throttle<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: number | undefined;
  return function (this: any, ...args: any[]) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      // @ts-ignore
      return fn.apply(this, args);
    }
    // @ts-ignore
    clearTimeout(timer);
    // @ts-ignore
    timer = window.setTimeout(() => {
      last = Date.now();
      // @ts-ignore
      fn.apply(this, args);
    }, Math.max(0, ms - (now - last)));
  } as T;
}

// ---------- UI ----------
function unmountSticky() {
  document.getElementById(NOTE_ID)?.remove();
}

async function mountSticky(videoId: string) {
  if (document.getElementById(NOTE_ID)) return; // already mounted

  const data = ensureVideoData(await loadVideo(videoId)); // load from extension storage
  const pos = await loadPosition(videoId);

  const wrapper = document.createElement('div');
  wrapper.id = NOTE_ID;
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    zIndex: '2147483647',
    background: 'rgba(0,0,0,0.92)',
    color: 'white',
    padding: '10px',
    borderRadius: '8px',
    width: '280px',
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    cursor: 'move',
  } as CSSStyleDeclaration);
  (wrapper.style as any).backdropFilter = 'blur(2px)';

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  });
  const title = document.createElement('strong');
  title.textContent = 'MimiNotes';
  Object.assign(title.style, { fontSize: '13px' });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✖';
  Object.assign(closeBtn.style, {
    fontSize: '12px',
    background: 'white',
    color: 'black',
    border: 'none',
    cursor: 'pointer',
    borderRadius: '4px',
    padding: '0 6px',
  });
  closeBtn.onclick = () => wrapper.remove();

  header.appendChild(title);
  header.appendChild(closeBtn);
  wrapper.appendChild(header);

  // Textarea
  const textarea = document.createElement('textarea');
  Object.assign(textarea.style, {
    width: '100%',
    fontSize: '12px',
    resize: 'none',
    border: '1px solid #444',
    borderRadius: '5px',
    padding: '6px',
    backgroundColor: 'black',
    color: 'white',
    outline: 'none',
  } as CSSStyleDeclaration);
  textarea.rows = 2;
  textarea.placeholder = 'Write your note...';
  wrapper.appendChild(textarea);

  // Buttons row
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, {
    width: '100%',
    marginTop: '6px',
    display: 'grid',
    gridTemplateColumns: '1fr 72px',
    gap: '6px',
  });

  const addBtn = document.createElement('button');
  addBtn.textContent = '⏱ Add Timestamp';
  Object.assign(addBtn.style, {
    background: 'white',
    color: 'black',
    padding: '6px 8px',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    width: '100%',
    cursor: 'pointer',
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  Object.assign(clearBtn.style, {
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
  });

  btnRow.appendChild(addBtn);
  btnRow.appendChild(clearBtn);
  wrapper.appendChild(btnRow);

  // List
  const listEl = document.createElement('ul');
  Object.assign(listEl.style, {
    marginTop: '10px',
    maxHeight: '180px',
    overflowY: 'auto',
    fontSize: '12px',
    paddingLeft: '0',
    listStyle: 'none',
  });
  wrapper.appendChild(listEl);

  document.body.appendChild(wrapper);

  // show existing notes immediately
  renderNoteList(data.notes, listEl, videoId);

  // Add note
  addBtn.onclick = async () => {
    const video = getVideoEl();
    const time = video ? Math.floor(video.currentTime) : null;
    const text = textarea.value.trim();
    if (time == null || !text) return;

    const newNote: MimiNote = {
      id: uuid(),
      createdAt: Date.now(),
      time,
      text,
      videoId,
    };

    const updated: MimiVideoData = {
      title: data.title || '',
      notes: [...data.notes, newNote].sort((a, b) => b.time - a.time),
    };

    await saveVideo(videoId, updated);
    textarea.value = '';
    data.notes = updated.notes; // local mirror
    renderNoteList(updated.notes, listEl, videoId);
  };

  // Clear all notes for this video
  clearBtn.onclick = async () => {
    const updated: MimiVideoData = { title: data.title || '', notes: [] };
    await saveVideo(videoId, updated);
    data.notes = [];
    renderNoteList([], listEl, videoId);
  };

  // Drag + persist (throttled) + clamp
  let dragging = false;
  let offX = 0,
    offY = 0;

  header.onmousedown = (e) => {
    dragging = true;
    offX = e.clientX - wrapper.offsetLeft;
    offY = e.clientY - wrapper.offsetTop;
    document.body.style.userSelect = 'none';
  };

  const savePosThrottled = throttle((x: number, y: number) => {
    void savePosition(videoId, { x, y });
  }, 250);

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const x = Math.min(
      Math.max(0, e.clientX - offX),
      window.innerWidth - wrapper.offsetWidth
    );
    const y = Math.min(
      Math.max(0, e.clientY - offY),
      window.innerHeight - wrapper.offsetHeight
    );
    wrapper.style.left = `${x}px`;
    wrapper.style.top = `${y}px`;
    savePosThrottled(x, y);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = 'auto';
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  // Cleanup on unmount
  const cleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  wrapper.addEventListener('DOMNodeRemoved', cleanup, { once: true });

  // Live sync: re-render if notes for this video change elsewhere (popup/another tab)
  const storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    changes,
    area
  ) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEY(videoId)]) return;
    const newVal = changes[STORAGE_KEY(videoId)].newValue;
    const normalized = ensureVideoData(newVal);
    data.notes = normalized.notes;
    renderNoteList(normalized.notes, listEl, videoId);
  };

  chrome.storage.onChanged.addListener(storageListener);
  wrapper.addEventListener(
    'DOMNodeRemoved',
    () => chrome.storage.onChanged.removeListener(storageListener),
    { once: true }
  );
}

function renderNoteList(notes: MimiNote[], container: HTMLElement, videoId: string) {
  container.innerHTML = '';
  notes.forEach((n, idx) => {
    const li = document.createElement('li');
    Object.assign(li.style, {
      marginBottom: '6px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '6px',
    });

    const span = document.createElement('span');
    span.textContent = `${formatTime(n.time)} – ${n.text}`;
    Object.assign(span.style, {
      cursor: 'pointer',
      color: '#7dd3fc',
      flex: '1',
    });
    span.title = new Date(n.createdAt).toLocaleString();
    span.onclick = () => {
      const video = getVideoEl();
      if (video) video.currentTime = n.time;
    };

    const del = document.createElement('button');
    del.textContent = '✕';
    Object.assign(del.style, {
      background: 'white',
      border: 'none',
      color: 'black',
      cursor: 'pointer',
      fontSize: '12px',
      borderRadius: '4px',
      padding: '0 6px',
    });
    del.onclick = async () => {
      const updated = notes.filter((_, i) => i !== idx);
      const next: MimiVideoData = { title: '', notes: updated };
      await saveVideo(videoId, next);
      renderNoteList(updated, container, videoId);
    };

    li.appendChild(span);
    li.appendChild(del);
    container.appendChild(li);
  });
}

// Listen for popup toggle with error reporting + response
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.type === 'TOGGLE_MIMI_NOTE') {
      const vid = parseYouTubeId(location.href) || 'default';
      const existing = document.getElementById(NOTE_ID);

      if (existing) {
        unmountSticky(); // toggle off
      } else {
        void mountSticky(vid); // toggle on
      }

      sendResponse({ ok: true });
    }
  } catch (e) {
    console.error('MimiNotes error handling message:', e);
    sendResponse({ ok: false, error: String(e) });
  }

  // No async sendResponse later; keep the channel synchronous.
  return false;
});


// (Optional) tiny injected banner
(() => {
  const id = 'mimi-debug-injected';
  if (!document.getElementById(id)) {
    const el = document.createElement('div');
    el.id = id;
    el.textContent = '✅ MimiNotes injected!';
    Object.assign(el.style, {
      position: 'fixed',
      top: '10px',
      left: '10px',
      background: 'black',
      color: 'lime',
      padding: '6px 12px',
      zIndex: '2147483647',
      borderRadius: '6px',
      fontFamily: 'monospace',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
})();
