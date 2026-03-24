import React, { useEffect, useState } from 'react';
import { socket } from '../lib/socket';
import { motion } from 'motion/react';
import { Users, Play, Plus, Image as ImageIcon, Grid, Clock } from 'lucide-react';

interface RoomConfig {
  roomId: string;
  imageUrl: string;
  cols: number;
  rows: number;
}

interface RoomMetadata extends RoomConfig {
  creator: string;
  createdAt: number;
  snappedCount?: number;
  totalPieces?: number;
}

interface HomeProps {
  existingRoom?: string;
  onEnter: (username: string, config?: RoomConfig) => void;
}

export default function Home({ existingRoom, onEnter }: HomeProps) {
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [isConnecting, setIsConnecting] = useState(true);
  const [username, setUsername] = useState(`익명_${Math.floor(Math.random() * 10000)}`);
  
  // Room creation state
  const [isCreating, setIsCreating] = useState(!existingRoom);
  const [imageUrl, setImageUrl] = useState('https://ewbjogsolylcbfmpmyfa.supabase.co/storage/v1/object/public/checki/2.jpg');
  const [pieceCount, setPieceCount] = useState<number>(150);
  const [isCalculating, setIsCalculating] = useState(false);
  const [activeRooms, setActiveRooms] = useState<RoomMetadata[]>([]);

  useEffect(() => {
    socket.on('connect', () => {
      setIsConnecting(false);
    });

    socket.on('rooms_list', (rooms: RoomMetadata[]) => {
      console.log('Received rooms:', rooms);
      // Sort by newest first
      rooms.sort((a, b) => b.createdAt - a.createdAt);
      setActiveRooms(rooms);
    });

    if (socket.connected) {
      setIsConnecting(false);
      socket.emit('get_rooms');
    }

    return () => {
      socket.off('connect');
      socket.off('rooms_list');
    };
  }, []);

  const handleCreateRoom = () => {
    if (!username.trim()) return;
    
    setIsCalculating(true);
    
    // Load image to get aspect ratio
    const img = new Image();
    img.onload = async () => {
      const aspectRatio = img.width / img.height;
      
      // Calculate cols and rows
      // rows * (rows * aspectRatio) ≈ targetPieces
      const rows = Math.round(Math.sqrt(pieceCount / aspectRatio));
      const cols = Math.round(rows * aspectRatio);
      
      const roomIdNum = Math.floor(Math.random() * 90000 + 10000);
      const roomId = roomIdNum.toString();
      const finalCols = Math.max(2, cols);
      const finalRows = Math.max(2, rows);
      
      const roomData = {
        id: roomId,
        name: `Room ${roomId}`,
        imageUrl,
        gridSize: finalCols * finalRows,
        cols: finalCols,
        rows: finalRows,
        creator: username,
        createdAt: Date.now(),
        pieces: [] // Will be initialized by the first player joining
      };

      socket.emit('create_room', roomData);
      
      onEnter(username, {
        roomId,
        imageUrl,
        cols: finalCols,
        rows: finalRows
      });
      setIsCalculating(false);
    };
    img.onerror = () => {
      alert('Failed to load image. Please check the URL.');
      setIsCalculating(false);
    };
    img.src = imageUrl;
  };

  const handleJoinRoom = () => {
    if (!username.trim()) return;
    // If joining an existing room, the config is already in App.tsx state
    onEnter(username);
  };

  const handleJoinSpecificRoom = (room: RoomMetadata) => {
    if (!username.trim()) {
      alert('Please enter your name first!');
      return;
    }
    
    onEnter(username, room);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center py-12 px-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`w-full grid grid-cols-1 gap-8 ${existingRoom ? 'max-w-md' : 'max-w-4xl md:grid-cols-2'}`}
      >
        {/* Left Column: Create/Join Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center h-fit">
          <div className="w-20 h-20 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
              <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.919.161-1.12.588l-.844 1.81c-.246.526-.784.846-1.368.846h-2.28c-.604 0-1.16-.33-1.43-.865l-.844-1.81a.996.996 0 0 1-1.12-.588.98.98 0 0 1-.837-.276L7.294 13.7c-.47-.47-.706-1.087-.706-1.704s.235-1.233.706-1.704l1.568-1.568c.23-.23.338-.556.289-.878l-.364-2.388c-.092-.604.2-1.19.734-1.486l2.023-1.112c.52-.286 1.157-.286 1.677 0l2.023 1.112c.534.296.826.882.734 1.486l-.364 2.388z"/>
            </svg>
          </div>
          
          <h1 className="text-3xl font-bold text-white mb-2">Multiplayer Puzzle</h1>
          <p className="text-slate-400 mb-8">
            {existingRoom ? 'Join the puzzle room and collaborate!' : 'Create a new puzzle room and invite friends!'}
          </p>
          
          <div className="mb-6">
            <input
              type="text"
              placeholder="Enter your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {isCreating && !existingRoom && (
            <div className="space-y-4 mb-8 text-left">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" /> Image URL
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/image.jpg"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <Grid className="w-4 h-4" /> Target Piece Count
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[20, 150, 300, 500, 1000].map(count => (
                    <button
                      key={count}
                      onClick={() => setPieceCount(count)}
                      className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                        pieceCount === count 
                          ? 'bg-indigo-500 text-white' 
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Actual count may vary slightly to maintain square pieces based on image aspect ratio.
                </p>
              </div>
            </div>
          )}

          {existingRoom && (
            <div className="bg-slate-950 rounded-2xl p-4 mb-8 flex items-center justify-between border border-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-300">Active Players</p>
                  <p className="text-xs text-slate-500">Currently in the room</p>
                </div>
              </div>
              <div className="text-2xl font-bold text-emerald-400">
                {isConnecting ? (
                  <span className="text-slate-600 animate-pulse">...</span>
                ) : (
                  playerCount
                )}
              </div>
            </div>
          )}
          
          <button
            onClick={existingRoom ? handleJoinRoom : handleCreateRoom}
            disabled={isConnecting || isCalculating || !username.trim()}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {existingRoom ? <Play className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            {isConnecting ? 'Connecting...' : isCalculating ? 'Calculating...' : existingRoom ? 'Join Puzzle Room' : 'Create Room'}
          </button>
        </div>

        {/* Right Column: Active Rooms Gallery */}
        {!existingRoom && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col h-[600px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Grid className="w-5 h-5 text-indigo-400" />
                Active Puzzle Rooms
              </h2>
              <button 
                onClick={() => {
                  socket.emit('get_rooms');
                }}
                className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800"
                title="Refresh room list"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
              {activeRooms.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <ImageIcon className="w-12 h-12 mb-3 opacity-20" />
                  <p>No active rooms yet.</p>
                  <p className="text-sm mt-1">Be the first to create one!</p>
                </div>
              ) : (
                activeRooms.map((room) => (
                  <div 
                    key={`${room.roomId}-${room.createdAt}`}
                    className="group bg-slate-950 border border-slate-800 hover:border-indigo-500/50 rounded-2xl overflow-hidden transition-all duration-300"
                  >
                    <div className="h-32 w-full overflow-hidden relative">
                      <img 
                        src={room.imageUrl} 
                        alt="Puzzle preview" 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                        <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-white px-2 py-1 rounded-md border border-slate-700">
                          {room.cols * room.rows} Pieces
                        </span>
                        <span className="text-xs text-slate-300 flex items-center gap-1 drop-shadow-md">
                          <Users className="w-3 h-3" /> Created by {room.creator}
                        </span>
                      </div>
                    </div>
                    {room.snappedCount !== undefined && room.totalPieces !== undefined && (
                      <div className="w-full bg-slate-800 h-1.5 overflow-hidden">
                        <div 
                          className="bg-indigo-500 h-full transition-all duration-500"
                          style={{ width: `${Math.round((room.snappedCount / room.totalPieces) * 100)}%` }}
                        />
                      </div>
                    )}
                    <div className="p-4 flex items-center justify-between">
                      <div className="text-left">
                        <p className="text-sm font-medium text-slate-300">Room #{room.roomId}</p>
                        {room.snappedCount !== undefined && room.totalPieces !== undefined && (
                          <p className="text-xs text-indigo-400 font-medium mt-1">
                            {Math.round((room.snappedCount / room.totalPieces) * 100)}% Complete ({room.snappedCount}/{room.totalPieces})
                          </p>
                        )}
                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" />
                          {new Date(room.createdAt || Date.now()).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleJoinSpecificRoom(room)}
                        className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
