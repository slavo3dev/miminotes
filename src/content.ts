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
const STORAGE_KEY = (vid: string) => `mimi_${vid}`;

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
  if (document.getElementById(NOTE_ID)) return;

  const data = ensureVideoData(await loadVideo(videoId));
  const pos = await loadPosition(videoId);

  // wrapper
  const wrapper = document.createElement('div');
  wrapper.id = NOTE_ID;
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    zIndex: '2147483647',
    width: '340px',
    background: '#0b0b0b',
    color: '#e5e7eb', // zinc-200
    padding: '12px',
    borderRadius: '14px',
    border: '1px solid #27272a', // zinc-800
    boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  } as CSSStyleDeclaration);

  (wrapper.style as any).backdropFilter = 'blur(2px)';

  // header (drag handle)
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
    cursor: 'move',
    userSelect: 'none',
  });
  const title = document.createElement('div');
  title.textContent = 'MimiNotes';
  Object.assign(title.style, { fontSize: '13px', color: '#fafafa', letterSpacing: '0.3px' });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  Object.assign(closeBtn.style, {
    height: '24px',
    width: '24px',
    borderRadius: '8px',
    border: '1px solid #3f3f46', // zinc-700
    background: 'transparent',
    color: '#a1a1aa', // zinc-400
    cursor: 'pointer',
  });
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = '#18181b';
    closeBtn.style.color = '#e4e4e7';
    closeBtn.style.borderColor = '#52525b';
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#a1a1aa';
    closeBtn.style.borderColor = '#3f3f46';
  };
  closeBtn.onclick = () => wrapper.remove();

  header.appendChild(title);
  header.appendChild(closeBtn);
  wrapper.appendChild(header);

  // grid: textarea + right column buttons
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 110px',
    gap: '8px',
    alignItems: 'start',
    marginBottom: '8px',
  });

  const textarea = document.createElement('textarea');
  Object.assign(textarea.style, {
    width: '100%',
    minHeight: '72px',
    borderRadius: '10px',
    border: '1px solid #3f3f46',
    backgroundColor: '#111113', // deep charcoal
    color: '#e5e7eb',
    outline: 'none',
    padding: '10px 12px',
    fontSize: '13px',
  } as CSSStyleDeclaration);
  textarea.placeholder = 'Write your note…';

  const btnCol = document.createElement('div');
  Object.assign(btnCol.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  });

  // timestamp button (align & height match popup)
  const tsBtn = document.createElement('button');
  tsBtn.textContent = '⏱ timestamp';
  Object.assign(tsBtn.style, baseBtnStyle({
    bg: '#0a0a0a',
    border: '#3f3f46',
    color: '#e5e7eb',
    hoverBg: '#18181b',
    hoverBorder: '#52525b',
  }));

  // add button (light)
  const addBtn = document.createElement('button');
  addBtn.textContent = '➕ add';
  Object.assign(addBtn.style, baseBtnStyle({
    bg: '#e5e7eb',
    border: '#3f3f46',
    color: '#000',
    hoverBg: '#ffffff',
    hoverBorder: '#52525b',
    bold: true,
  }));

  btnCol.appendChild(tsBtn);
  btnCol.appendChild(addBtn);

  grid.appendChild(textarea);
  grid.appendChild(btnCol);
  wrapper.appendChild(grid);

  // subtle toolbar row (clear all)
  const toolsRow = document.createElement('div');
  Object.assign(toolsRow.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: '6px',
  });
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '🗑 clear all';
  Object.assign(clearBtn.style, {
    height: '28px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #7f1d1d',
    background: '#b91c1c',
    color: '#fff',
    fontSize: '11px',
    cursor: 'pointer',
  });
  clearBtn.onmouseenter = () => (clearBtn.style.background = '#dc2626');
  clearBtn.onmouseleave = () => (clearBtn.style.background = '#b91c1c');
  toolsRow.appendChild(clearBtn);
  wrapper.appendChild(toolsRow);

  // list
  const listEl = document.createElement('ul');
  Object.assign(listEl.style, {
    marginTop: '4px',
    maxHeight: '200px',
    overflowY: 'auto',
    paddingLeft: '0',
    listStyle: 'none',
  });
  wrapper.appendChild(listEl);

  document.body.appendChild(wrapper);

  // render existing notes
  renderNoteList(data.notes, listEl, videoId);

  // timestamp button just previews current time by inserting a prefix
  tsBtn.onclick = () => {
    const video = getVideoEl();
    const t = video ? Math.floor(video.currentTime) : null;
    if (t == null) return;
    const prefix = `${formatTime(t)} – `;
    // only prefix if not already present
    if (!textarea.value.startsWith(prefix)) {
      textarea.value = prefix + textarea.value;
    }
  };

  // add note (takes current time + text)
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
    data.notes = updated.notes;
    renderNoteList(updated.notes, listEl, videoId);
  };

  clearBtn.onclick = async () => {
    const updated: MimiVideoData = { title: data.title || '', notes: [] };
    await saveVideo(videoId, updated);
    data.notes = [];
    renderNoteList([], listEl, videoId);
  };

  // Drag + persist (throttled + clamped)
  let dragging = false;
  let offX = 0, offY = 0;
  header.onmousedown = (e) => {
    dragging = true;
    offX = e.clientX - wrapper.offsetLeft;
    offY = e.clientY - wrapper.offsetTop;
    document.body.style.userSelect = 'none';
  };
  const savePosThrottled = throttle((x: number, y: number) => void savePosition(videoId, { x, y }), 250);
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const x = Math.min(Math.max(0, e.clientX - offX), window.innerWidth - wrapper.offsetWidth);
    const y = Math.min(Math.max(0, e.clientY - offY), window.innerHeight - wrapper.offsetHeight);
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

  // cleanup listeners
  const cleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  wrapper.addEventListener('DOMNodeRemoved', cleanup, { once: true });

  // live sync with storage
  const storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEY(videoId)]) return;
    const normalized = ensureVideoData(changes[STORAGE_KEY(videoId)].newValue);
    data.notes = normalized.notes;
    renderNoteList(normalized.notes, listEl, videoId);
  };
  chrome.storage.onChanged.addListener(storageListener);
  wrapper.addEventListener('DOMNodeRemoved', () => chrome.storage.onChanged.removeListener(storageListener), { once: true });
}

// shared button style builder (keeps both buttons identical height/alignment)
function baseBtnStyle(opts: { bg: string; border: string; color: string; hoverBg: string; hoverBorder: string; bold?: boolean; }) {
  const style: Partial<CSSStyleDeclaration> = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '36px',
    borderRadius: '10px',
    border: `1px solid ${opts.border}`,
    background: opts.bg,
    color: opts.color,
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'background .15s ease, border-color .15s ease, color .15s ease',
  };
  if (opts.bold) (style as any).fontWeight = 600;

  // hover emulation via listeners (since we’re inline styles)
  const addHover = (btn: HTMLButtonElement) => {
    btn.onmouseenter = () => {
      btn.style.background = opts.hoverBg;
      btn.style.borderColor = opts.hoverBorder;
    };
    btn.onmouseleave = () => {
      btn.style.background = opts.bg;
      btn.style.borderColor = opts.border;
    };
  };
  // return as any; caller will Object.assign then call addHover
  (style as any)._addHover = addHover;
  return style as CSSStyleDeclaration & { _addHover?: (btn: HTMLButtonElement) => void };
}

function renderNoteList(notes: MimiNote[], container: HTMLElement, videoId: string) {
  container.innerHTML = '';
  notes.forEach((n, idx) => {
    const li = document.createElement('li');
    Object.assign(li.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      border: '1px solid #27272a',
      background: 'rgba(9,9,11,0.7)', // zinc-950/70
      padding: '8px 10px',
      borderRadius: '12px',
      marginBottom: '6px',
    });

    const left = document.createElement('button');
    left.type = 'button';
    Object.assign(left.style, {
      flex: '1',
      textAlign: 'left',
      background: 'transparent',
      border: 'none',
      color: '#e5e7eb',
      cursor: 'pointer',
      fontSize: '13px',
    });
    left.title = new Date(n.createdAt).toLocaleString();

    const chip = document.createElement('span');
    chip.textContent = formatTime(n.time);
    Object.assign(chip.style, {
      display: 'inline-block',
      fontSize: '10px',
      padding: '2px 8px',
      borderRadius: '999px',
      border: '1px solid #3f3f46',
      background: '#111113',
      color: '#d4d4d8',
      marginRight: '8px',
    });

    const text = document.createElement('span');
    text.textContent = n.text;

    left.appendChild(chip);
    left.appendChild(text);

    left.onclick = () => {
      const video = getVideoEl();
      if (video) video.currentTime = n.time;
    };

    const del = document.createElement('button');
    del.textContent = '×';
    Object.assign(del.style, {
      height: '24px',
      width: '24px',
      borderRadius: '8px',
      border: '1px solid #3f3f46',
      background: 'transparent',
      color: '#a1a1aa',
      cursor: 'pointer',
      flexShrink: '0',
    });
    del.onmouseenter = () => {
      del.style.background = '#18181b';
      del.style.color = '#e4e4e7';
      del.style.borderColor = '#52525b';
    };
    del.onmouseleave = () => {
      del.style.background = 'transparent';
      del.style.color = '#a1a1aa';
      del.style.borderColor = '#3f3f46';
    };
    del.onclick = async () => {
      const updated = notes.filter((_, i) => i !== idx);
      const next: MimiVideoData = { title: '', notes: updated };
      await saveVideo(videoId, next);
      renderNoteList(updated, container, videoId);
    };

    li.appendChild(left);
    li.appendChild(del);
    container.appendChild(li);
  });
}

// Listen for popup toggle with response
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.type === 'TOGGLE_MIMI_NOTE') {
      const vid = parseYouTubeId(location.href) || 'default';
      const existing = document.getElementById(NOTE_ID);
      if (existing) unmountSticky();
      else void mountSticky(vid);
      sendResponse({ ok: true });
    }
  } catch (e) {
    console.error('MimiNotes error handling message:', e);
    sendResponse({ ok: false, error: String(e) });
  }
  return false;
});

// Optional tiny banner
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
    setTimeout(() => el.remove(), 900);
  }
})();
