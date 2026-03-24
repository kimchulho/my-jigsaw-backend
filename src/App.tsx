/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import PuzzleBoard from './components/PuzzleBoard';
import Home from './components/Home';

export default function App() {
  const [view, setView] = useState<'home' | 'puzzle'>('home');
  const [username, setUsername] = useState('Anonymous');
  const [roomConfig, setRoomConfig] = useState<{
    roomId: string;
    imageUrl: string;
    cols: number;
    rows: number;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    const img = params.get('img');
    const cols = params.get('cols');
    const rows = params.get('rows');

    if (room && img && cols && rows) {
      setRoomConfig({
        roomId: room,
        imageUrl: img,
        cols: parseInt(cols, 10),
        rows: parseInt(rows, 10),
      });
    }
  }, []);

  return (
    <>
      {view === 'home' && (
        <Home 
          existingRoom={roomConfig?.roomId} 
          onEnter={(name, config) => { 
            setUsername(name); 
            if (config) {
              setRoomConfig(config);
              // Update URL without reloading
              const newUrl = `${window.location.pathname}?room=${config.roomId}&img=${encodeURIComponent(config.imageUrl)}&cols=${config.cols}&rows=${config.rows}`;
              window.history.pushState({ path: newUrl }, '', newUrl);
            }
            setView('puzzle'); 
          }} 
        />
      )}
      {view === 'puzzle' && roomConfig && (
        <PuzzleBoard 
          username={username} 
          roomConfig={roomConfig}
          onBack={() => {
            setView('home');
            // Clear URL
            window.history.pushState({ path: window.location.pathname }, '', window.location.pathname);
            setRoomConfig(null);
          }} 
        />
      )}
    </>
  );
}
