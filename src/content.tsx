import React from 'react';
import ReactDOM from 'react-dom/client';
import Draggable from 'react-draggable';

// 🔍 DEBUG INJECTION CHECK
alert('✅ MimiNotes content script injected!');
console.log('✅ content.js is executing in tab');

// Optional: add hard test div
const testDiv = document.createElement('div');
testDiv.textContent = '✅ Hello from MimiNotes';
testDiv.style.position = 'fixed';
testDiv.style.top = '50px';
testDiv.style.left = '50px';
testDiv.style.background = 'black';
testDiv.style.color = 'white';
testDiv.style.padding = '10px';
testDiv.style.zIndex = '99999';
document.body.appendChild(testDiv);

// 🔲 React container
const container = document.createElement('div');
container.id = 'mimi-draggable-container';
document.body.appendChild(container);

// 🎯 Sticky Note Component
const Note = () => {
  const [text, setText] = React.useState(() => localStorage.getItem('mimi_note_text') || '');
  const [visible, setVisible] = React.useState(true);

  console.log('🎯 MimiNote React component mounted');

  const handleStop = (e: any, data: any) => {
    localStorage.setItem('mimi_note_pos', JSON.stringify({ x: data.x, y: data.y }));
  };

  const position = JSON.parse(localStorage.getItem('mimi_note_pos') || '{"x": 100, "y": 100}');

  return visible ? (
    <Draggable defaultPosition={position} onStop={handleStop}>
      <div
        style={{
          position: 'fixed',
          zIndex: 9999,
          backgroundColor: '#111',
          color: '#fff',
          padding: '10px',
          borderRadius: '8px',
          width: '220px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: '13px',
            marginBottom: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontWeight: 'bold',
          }}
        >
          MimiNote
          <button
            onClick={() => setVisible(false)}
            style={{
              fontSize: '12px',
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Close"
          >
            ✖
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            localStorage.setItem('mimi_note_text', e.target.value);
          }}
          rows={4}
          style={{
            width: '100%',
            fontSize: '12px',
            resize: 'none',
            border: '1px solid #333',
            borderRadius: '5px',
            padding: '5px',
            backgroundColor: '#222',
            color: '#fff',
          }}
        />
      </div>
    </Draggable>
  ) : null;
};

// ⏬ Mount it into the page
ReactDOM.createRoot(container).render(<Note />);
