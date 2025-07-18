console.log('🔥 MimiNotes content.ts executing');

const debugId = 'mimi-debug-injected';
if (!document.getElementById(debugId)) {
  const banner = document.createElement('div');
  banner.textContent = '✅ MimiNotes injected!';
  banner.id = debugId;
  Object.assign(banner.style, {
    position: 'fixed',
    top: '10px',
    left: '10px',
    background: 'black',
    color: 'lime',
    padding: '6px 12px',
    zIndex: '999999',
  });
  document.body.appendChild(banner);
}

function getVideoId(): string {
  const match = window.location.href.match(/[?&]v=([^&#]+)/);
  return match ? match[1] : 'default';
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function createStickyNote(videoId: string) {
  if (document.getElementById('mimi-draggable-note')) return;

  const fullData = JSON.parse(localStorage.getItem(`mimi_${videoId}`) || '{"title":"","notes":[]}');
  const notes = fullData.notes || [];

  const savedPos = JSON.parse(localStorage.getItem(`mimi_note_pos_${videoId}`) || '{"x":100,"y":100}');

  const wrapper = document.createElement('div');
  wrapper.id = 'mimi-draggable-note';
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: `${savedPos.x}px`,
    top: `${savedPos.y}px`,
    zIndex: '99999',
    background: 'black',
    color: 'white',
    padding: '10px',
    borderRadius: '8px',
    width: '260px',
    fontFamily: 'sans-serif',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    cursor: 'move'
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '5px',
  });
  header.innerHTML = `
    <strong style="font-size:13px;">MimiNote</strong>
    <button style="font-size:12px; background:white; color:black; border:none; cursor:pointer; border-radius:4px; padding: 0 6px">✖</button>
  `;
  header.querySelector('button')!.onclick = () => wrapper.remove();
  wrapper.appendChild(header);

  const textarea = document.createElement('textarea');
  Object.assign(textarea.style, {
    width: '100%',
    fontSize: '12px',
    resize: 'none',
    border: '1px solid white',
    borderRadius: '5px',
    padding: '5px',
    backgroundColor: 'black',
    color: 'white'
  });
  textarea.rows = 2;
  textarea.placeholder = 'Write your note...';
  wrapper.appendChild(textarea);

  const buttonWrapper = document.createElement('div');
  Object.assign(buttonWrapper.style, {
    width: '100%',
    marginTop: '6px'
  });

  const btn = document.createElement('button');
  btn.textContent = '⏱ Add Timestamp';
  Object.assign(btn.style, {
    background: 'white',
    color: 'black',
    padding: '4px 8px',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    width: '100%',
    cursor: 'pointer'
  });
  buttonWrapper.appendChild(btn);
  wrapper.appendChild(buttonWrapper);

  const listEl = document.createElement('ul');
  Object.assign(listEl.style, {
    marginTop: '10px',
    maxHeight: '150px',
    overflowY: 'auto',
    fontSize: '12px',
    paddingLeft: '0',
    listStyle: 'none'
  });
  wrapper.appendChild(listEl);

  document.body.appendChild(wrapper);
  renderNoteList(notes, listEl, videoId);

  btn.onclick = () => {
    const video = document.querySelector('video');
    const time = video ? Math.floor(video.currentTime) : null;
    const text = textarea.value.trim();
    if (!text || time === null) return;

    const newNote = { time, text, videoId };
    const updatedNotes = [...(fullData.notes || []), newNote].sort((a, b) => b.time - a.time);
    const updated = { title: fullData.title || '', notes: updatedNotes };

    localStorage.setItem(`mimi_${videoId}`, JSON.stringify(updated));
    textarea.value = '';
    renderNoteList(updatedNotes, listEl, videoId);
  };

  // 🧲 Drag logic
  let isDragging = false;
  let offsetX = 0, offsetY = 0;
  header.onmousedown = (e) => {
    isDragging = true;
    offsetX = e.clientX - wrapper.offsetLeft;
    offsetY = e.clientY - wrapper.offsetTop;
    document.body.style.userSelect = 'none';
  };
  document.onmouseup = () => {
    if (isDragging) {
      isDragging = false;
      localStorage.setItem(`mimi_note_pos_${videoId}`, JSON.stringify({
        x: wrapper.offsetLeft,
        y: wrapper.offsetTop
      }));
      document.body.style.userSelect = 'auto';
    }
  };
  document.onmousemove = (e) => {
    if (isDragging) {
      wrapper.style.left = `${e.clientX - offsetX}px`;
      wrapper.style.top = `${e.clientY - offsetY}px`;
    }
  };
}

function renderNoteList(
  notes: { time: number; text: string; videoId: string }[],
  container: HTMLElement,
  videoId: string
) {
  container.innerHTML = '';
  notes.forEach((note, i) => {
    const li = document.createElement('li');
    Object.assign(li.style, {
      marginBottom: '6px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    });

    const span = document.createElement('span');
    span.textContent = `${formatTime(note.time)} – ${note.text}`;
    Object.assign(span.style, {
      cursor: 'pointer',
      color: 'red',
      flex: '1'
    });
    span.onclick = () => {
      const video = document.querySelector('video');
      if (video) video.currentTime = note.time;
    };

    const del = document.createElement('button');
    del.textContent = '✕';
    Object.assign(del.style, {
      background: 'white',
      border: 'none',
      color: 'black',
      cursor: 'pointer',
      fontSize: '12px',
      marginLeft: '8px',
      borderRadius: '4px'
    });
    del.onclick = () => {
      const updated = notes.filter((_, idx) => idx !== i);
      const fullData = JSON.parse(localStorage.getItem(`mimi_${videoId}`) || '{"title":"","notes":[]}');
      const updatedData = { title: fullData.title, notes: updated };
      localStorage.setItem(`mimi_${videoId}`, JSON.stringify(updatedData));
      renderNoteList(updated, container, videoId);
    };

    li.appendChild(span);
    li.appendChild(del);
    container.appendChild(li);
  });
}

// 🔁 Listen for popup toggle
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TOGGLE_MIMI_NOTE') {
    const videoId = getVideoId();
    console.log('📩 Showing sticky note for videoId:', videoId);
    createStickyNote(videoId);
  }
});
