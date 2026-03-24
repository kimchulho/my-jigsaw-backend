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
  const [existingRoomId, setExistingRoomId] = useState<string | undefined>(undefined);
  const [roomConfig, setRoomConfig] = useState<{
    roomId: string;
    imageUrl: string;
    cols: number;
    rows: number;
    maxPlayers?: number;
    password?: string;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setExistingRoomId(room);
    }
  }, []);

  return (
    <>
      {view === 'home' && (
        <Home 
          existingRoom={existingRoomId} 
          onEnter={(name, config) => { 
            setUsername(name); 
            if (config) {
              setRoomConfig(config);
              // Update URL without reloading
              const newUrl = `${window.location.pathname}?room=${config.roomId}`;
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
            setExistingRoomId(undefined);
          }} 
        />
      )}
    </>
  );
}
