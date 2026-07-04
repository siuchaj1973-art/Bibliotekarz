import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { PlayerProvider } from './player/PlayerContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
