import React, { useEffect, useState } from 'react';
import { socket } from '../lib/socket';
import { motion } from 'motion/react';
import { Users, Play, Plus, Image as ImageIcon, Grid, Clock, Trophy } from 'lucide-react';

interface RoomConfig {
  roomId: string;
  imageUrl: string;
  cols: number;
  rows: number;
  maxPlayers?: number;
  password?: string;
}

interface RoomMetadata extends RoomConfig {
  creator: string;
  createdAt: number;
  snappedCount?: number;
  totalPieces?: number;
  hasPassword?: boolean;
  currentPlayers?: number;
  playTime?: number;
}

interface HomeProps {
  existingRoom?: string;
  existingPassword?: string;
  onEnter: (username: string, config?: RoomConfig) => void;
}

const getBrowserTag = () => {
  let tag = localStorage.getItem('puzzle_user_tag');
  if (!tag) {
    tag = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    localStorage.setItem('puzzle_user_tag', tag);
  }
  return tag;
};

export default function Home({ existingRoom, existingPassword, onEnter }: HomeProps) {
  const [isConnecting, setIsConnecting] = useState(true);
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('puzzle_username') || `익명#${getBrowserTag()}`;
  });
  
  useEffect(() => {
    localStorage.setItem('puzzle_username', username);
  }, [username]);
  
  // Room creation state
  const [isCreating, setIsCreating] = useState(!existingRoom);
  const [imageUrl, setImageUrl] = useState('https://ewbjogsolylcbfmpmyfa.supabase.co/storage/v1/object/public/checki/2.jpg');
  const [pieceCount, setPieceCount] = useState<number>(100);
  const [maxPlayers, setMaxPlayers] = useState<number>(8);
  const [password, setPassword] = useState<string>('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [activeRooms, setActiveRooms] = useState<RoomMetadata[]>([]);
  const [hasLoadedRooms, setHasLoadedRooms] = useState(false);
  const autoJoinAttempted = React.useRef(false);

  const foundRoom = existingRoom ? activeRooms.find(r => r.roomId === existingRoom) : undefined;
  const isInvalidRoom = existingRoom && hasLoadedRooms && !foundRoom;

  useEffect(() => {
    if (hasLoadedRooms && existingRoom && !autoJoinAttempted.current) {
      autoJoinAttempted.current = true;
      const room = activeRooms.find(r => r.roomId === existingRoom);
      
      if (room) {
        if (room.currentPlayers && room.maxPlayers && room.currentPlayers >= room.maxPlayers) {
          alert('This room is full.');
          return;
        }

        let joinPassword = existingPassword;
        if (room.hasPassword && !joinPassword) {
          const pwd = prompt('Enter room password:');
          if (pwd === null) return;
          joinPassword = pwd;
        }

        let finalUsername = username.trim();
        if (!finalUsername.includes('#')) {
          finalUsername = `${finalUsername}#${getBrowserTag()}`;
          setUsername(finalUsername);
          localStorage.setItem('puzzle_username', finalUsername);
        }

        socket.emit('join_room', { roomId: room.roomId, password: joinPassword }, (res: any) => {
          if (res && res.success) {
            onEnter(finalUsername, {
              roomId: room.roomId,
              imageUrl: room.imageUrl,
              cols: room.cols,
              rows: room.rows,
              maxPlayers: room.maxPlayers,
              password: joinPassword
            });
          } else {
            alert(res?.message || 'Failed to join room');
            window.history.pushState({}, '', window.location.pathname);
            window.location.reload();
          }
        });
      } else {
        alert('방을 찾을 수 없습니다. 이미 삭제되었거나 존재하지 않는 방입니다.');
        window.history.pushState({}, '', window.location.pathname);
        window.location.reload();
      }
    }
  }, [hasLoadedRooms, existingRoom, activeRooms, existingPassword, username, onEnter]);

  useEffect(() => {
    socket.on('connect', () => {
      setIsConnecting(false);
    });

    socket.on('rooms_list', (rooms: RoomMetadata[]) => {
      console.log('Received rooms:', rooms);
      // Sort by newest first
      rooms.sort((a, b) => b.createdAt - a.createdAt);
      setActiveRooms(rooms);
      setHasLoadedRooms(true);
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
    let finalUsername = username.trim();
    if (!finalUsername) return;
    
    if (!finalUsername.includes('#')) {
      finalUsername = `${finalUsername}#${getBrowserTag()}`;
      setUsername(finalUsername);
      localStorage.setItem('puzzle_username', finalUsername);
    }
    
    setIsCalculating(true);
    
    // Load image to get aspect ratio
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      const aspectRatio = img.width / img.height;
      
      // Calculate cols and rows
      // rows * (rows * aspectRatio) ≈ targetPieces
      const rows = Math.round(Math.sqrt(pieceCount / aspectRatio));
      const cols = Math.round(rows * aspectRatio);
      
      const roomIdNum = Math.floor(Math.random() * 90000 + 10000);
      const roomId = roomIdNum.toString();
      
      // 조각 수 제한 (최대 1000개)
      let finalCols = Math.max(2, cols);
      let finalRows = Math.max(2, rows);
      if (finalCols * finalRows > 1000) {
        const ratio = Math.sqrt(1000 / (finalCols * finalRows));
        finalCols = Math.max(2, Math.floor(finalCols * ratio));
        finalRows = Math.max(2, Math.floor(finalRows * ratio));
        
        // 최종 안전장치: 1000개 이하가 될 때까지 조각 수 감소
        while (finalCols * finalRows > 1000) {
          if (finalCols > finalRows) finalCols--;
          else finalRows--;
        }
      }
      
      const roomData = {
        id: roomId,
        name: `Room ${roomId}`,
        imageUrl,
        gridSize: finalCols * finalRows,
        cols: finalCols,
        rows: finalRows,
        creator: finalUsername,
        createdAt: Date.now(),
        maxPlayers,
        password: password.trim() || undefined,
        pieces: [] // Will be initialized by the first player joining
      };

      socket.emit('create_room', roomData, (res: any) => {
        onEnter(finalUsername, {
          roomId,
          imageUrl,
          cols: finalCols,
          rows: finalRows,
          maxPlayers,
          password: password.trim() || undefined
        });
        setIsCalculating(false);
      });
    };
    img.onerror = () => {
      alert('이미지를 불러올 수 없습니다. CORS를 지원하지 않는 이미지이거나 URL이 잘못되었습니다.');
      setIsCalculating(false);
    };
    img.src = imageUrl;
  };

  const handleJoinRoom = () => {
    let finalUsername = username.trim();
    if (!finalUsername) return;
    
    if (!finalUsername.includes('#')) {
      finalUsername = `${finalUsername}#${getBrowserTag()}`;
      setUsername(finalUsername);
      localStorage.setItem('puzzle_username', finalUsername);
    }
    
    const foundRoom = activeRooms.find(r => r.roomId === existingRoom);
    
    if (foundRoom) {
      if (foundRoom.currentPlayers && foundRoom.maxPlayers && foundRoom.currentPlayers >= foundRoom.maxPlayers) {
        alert('This room is full.');
        return;
      }
      
      let joinPassword = undefined;
      if (foundRoom.hasPassword) {
        const pwd = prompt('Enter room password:');
        if (pwd === null) return;
        joinPassword = pwd;
      }

      socket.emit('join_room', { roomId: foundRoom.roomId, password: joinPassword }, (res: any) => {
        if (res && res.success) {
          onEnter(finalUsername, {
            roomId: foundRoom.roomId,
            imageUrl: foundRoom.imageUrl,
            cols: foundRoom.cols,
            rows: foundRoom.rows,
            maxPlayers: foundRoom.maxPlayers,
            password: joinPassword
          });
        } else {
          alert(res?.message || 'Failed to join room');
        }
      });
    } else {
      alert('방을 찾을 수 없습니다. 이미 삭제되었거나 존재하지 않는 방입니다.');
      window.history.pushState({}, '', window.location.pathname);
      window.location.reload();
    }
  };

  const handleJoinSpecificRoom = (room: RoomMetadata) => {
    let finalUsername = username.trim();
    if (!finalUsername) {
      alert('Please enter your name first!');
      return;
    }
    
    if (room.currentPlayers && room.maxPlayers && room.currentPlayers >= room.maxPlayers) {
      alert('This room is full.');
      return;
    }

    if (!finalUsername.includes('#')) {
      finalUsername = `${finalUsername}#${getBrowserTag()}`;
      setUsername(finalUsername);
      localStorage.setItem('puzzle_username', finalUsername);
    }
    
    let joinPassword = undefined;
    if (room.hasPassword) {
      const pwd = prompt('Enter room password:');
      if (pwd === null) return;
      joinPassword = pwd;
    }

    socket.emit('join_room', { roomId: room.roomId, password: joinPassword }, (res: any) => {
      if (res && res.success) {
        onEnter(finalUsername, {
          ...room,
          password: joinPassword
        });
      } else {
        alert(res?.message || 'Failed to join room');
      }
    });
  };

  const inProgressRooms = activeRooms.filter(r => r.snappedCount === undefined || r.totalPieces === undefined || r.snappedCount < r.totalPieces);
  const completedRooms = activeRooms.filter(r => r.snappedCount !== undefined && r.totalPieces !== undefined && r.snappedCount >= r.totalPieces);

  const formatTime = (seconds: number) => {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center py-12 px-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`w-full grid grid-cols-1 gap-8 ${existingRoom ? 'max-w-md' : 'max-w-7xl lg:grid-cols-3 md:grid-cols-2'}`}
      >
        {/* Left Column: Create/Join Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center h-fit">
          <div className="w-24 h-24 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg width="60" height="60" viewBox="-20 -30 200 200" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
              <path d="M25.18,11.87c0,20.95,13.8,42.39,4.85,42.68-8.95.29-11.99-6.96-17.69-6.96s-8.34,4.77-8.34,18.59,2.64,18.59,8.34,18.59,8.74-7.24,17.69-6.96c8.95.29-4.85,21.73-4.85,42.68,20.95,0,42.39,13.8,42.68,4.85.29-8.95-6.96-11.99-6.96-17.69s4.77-8.34,18.59-8.34,18.59,2.64,18.59,8.34-7.24,8.74-6.96,17.69c.29,8.95,21.73-4.85,42.68-4.85,0-20.95-13.8-42.39-4.85-42.68s11.99,6.96,17.69,6.96,8.34-4.77,8.34-18.59-2.64-18.59-8.34-18.59-8.74,7.24-17.69,6.96c-8.95-.29,4.85-21.73,4.85-42.68-20.95,0-42.39-13.8-42.68-4.85s6.96,11.99,6.96,17.69-4.77,8.34-18.59,8.34-18.59-2.64-18.59-8.34,7.24-8.74,6.96-17.69c-.29-8.95-21.73,4.85-42.68,4.85Z"/>
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
                <div className="grid grid-cols-6 gap-2">
                  {[20, 100, 150, 300, 500, 1000].map(count => (
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

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                    <Users className="w-4 h-4" /> Max Players
                  </label>
                  <select
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
                      <option key={num} value={num}>{num} {num === 1 ? 'Player' : 'Players'}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Password (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Leave empty for public"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Removed Active Players section as it's not tracked in Home.tsx */}
          
          {isInvalidRoom && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl mb-6 text-sm text-center">
              방을 찾을 수 없습니다. 이미 삭제되었거나 존재하지 않는 방입니다.
              <button 
                onClick={() => {
                  window.history.pushState({}, '', window.location.pathname);
                  window.location.reload();
                }}
                className="block w-full mt-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 py-2 rounded-lg transition-colors"
              >
                새로운 방 만들기
              </button>
            </div>
          )}
          
          <button
            onClick={existingRoom ? handleJoinRoom : handleCreateRoom}
            disabled={isConnecting || isCalculating || !username.trim() || (existingRoom ? !hasLoadedRooms : false) || isInvalidRoom}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {existingRoom ? <Play className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            {isConnecting ? 'Connecting...' : (existingRoom && !hasLoadedRooms) ? 'Loading room info...' : isCalculating ? 'Calculating...' : isInvalidRoom ? 'Invalid Room' : existingRoom ? 'Join Puzzle Room' : 'Create Room'}
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
              {inProgressRooms.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <ImageIcon className="w-12 h-12 mb-3 opacity-20" />
                  <p>No active rooms yet.</p>
                  <p className="text-sm mt-1">Be the first to create one!</p>
                </div>
              ) : (
                inProgressRooms.map((room) => (
                  <div 
                    key={`${room.roomId}-${room.createdAt}`}
                    className="group bg-slate-950 border border-slate-800 hover:border-indigo-500/50 rounded-2xl overflow-hidden transition-all duration-300"
                  >
                    <div className="h-32 w-full overflow-hidden relative">
                      <img 
                        src={room.imageUrl} 
                        alt="Puzzle preview" 
                        className={`w-full h-full object-cover transition-transform duration-500 ${room.hasPassword ? 'blur-xl scale-125' : 'group-hover:scale-105'}`}
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                        <div className="flex gap-2 items-center">
                          <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-white px-2 py-1 rounded-md border border-slate-700">
                            {room.cols * room.rows} Pieces
                          </span>
                          {room.hasPassword && (
                            <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-amber-400 px-2 py-1 rounded-md border border-slate-700 flex items-center gap-1">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            </span>
                          )}
                        </div>
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
                        <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
                          Room #{room.roomId}
                          {room.currentPlayers !== undefined && room.maxPlayers !== undefined && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-md ${room.currentPlayers >= room.maxPlayers ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                              {room.currentPlayers}/{room.maxPlayers}
                            </span>
                          )}
                        </p>
                        {room.snappedCount !== undefined && room.totalPieces !== undefined && (
                          <p className="text-xs text-indigo-400 font-medium mt-1">
                            {Math.round((room.snappedCount / room.totalPieces) * 100)}% Complete ({room.snappedCount}/{room.totalPieces})
                          </p>
                        )}
                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" />
                          {new Date(room.createdAt || Date.now()).toLocaleDateString()}
                          {room.playTime !== undefined && (
                            <span className="ml-2 text-indigo-400 font-mono">
                              {formatTime(room.playTime)}
                            </span>
                          )}
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

        {/* Right Column: Completed Rooms Gallery */}
        {!existingRoom && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col h-[600px] md:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                Completed Puzzles
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {completedRooms.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <Trophy className="w-12 h-12 mb-3 opacity-20" />
                  <p>No completed puzzles yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
                  {completedRooms.map((room) => (
                    <div 
                      key={`${room.roomId}-${room.createdAt}`}
                      className="group bg-slate-950 border border-slate-800 hover:border-amber-500/50 rounded-2xl overflow-hidden transition-all duration-300"
                    >
                      <div className="h-32 w-full overflow-hidden relative">
                        <img 
                          src={room.imageUrl} 
                          alt="Puzzle preview" 
                          className={`w-full h-full object-cover transition-transform duration-500 ${room.hasPassword ? 'blur-xl scale-125' : 'group-hover:scale-105'}`}
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                          <div className="flex gap-2 items-center">
                            <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-white px-2 py-1 rounded-md border border-slate-700">
                              {room.cols * room.rows} Pieces
                            </span>
                            {room.hasPassword && (
                              <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-amber-400 px-2 py-1 rounded-md border border-slate-700 flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-300 flex items-center gap-1 drop-shadow-md">
                            <Users className="w-3 h-3" /> Created by {room.creator}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 overflow-hidden">
                        <div className="bg-amber-500 h-full w-full" />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="text-left">
                          <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
                            Room #{room.roomId}
                          </p>
                          <p className="text-xs text-amber-400 font-medium mt-1">
                            100% Complete
                          </p>
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                            <Clock className="w-3 h-3" />
                            {new Date(room.createdAt || Date.now()).toLocaleDateString()}
                            {room.playTime !== undefined && (
                              <span className="ml-2 text-amber-400 font-mono">
                                {formatTime(room.playTime)}
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => handleJoinSpecificRoom(room)}
                          className="bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                        >
                          View
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
