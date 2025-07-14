// src/popup.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; 
import { Popup } from './component/popup';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
