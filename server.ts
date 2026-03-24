import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

if (!supabase) {
  console.warn('⚠️ Supabase credentials not found. Falling back to in-memory storage.');
}

// In-memory fallback
const memoryRooms = new Map<string, any>();
const memoryPieces = new Map<string, any[]>();
const memoryScores = new Map<string, { score: number }>();
const roomPlayTimes = new Map<string, number>();
const roomCompleted = new Set<string>();

async function getRoomsFromDB(io?: Server) {
  if (!supabase) {
    return Array.from(memoryRooms.values()).map(r => {
      const pieces = memoryPieces.get(r.roomId) || [];
      const snappedCount = pieces.filter((p: any) => p.is_snapped).length;
      const currentPlayers = io ? (io.sockets.adapter.rooms.get(`room_${r.roomId}`)?.size || 0) : 0;
      return { ...r, snappedCount, totalPieces: r.cols * r.rows, hasPassword: !!r.password, currentPlayers, playTime: roomPlayTimes.get(r.roomId) || 0, isCompleted: roomCompleted.has(r.roomId) };
    }).sort((a, b) => b.createdAt - a.createdAt);
  }
  const { data, error } = await supabase.from('puzzle_rooms').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching rooms from Supabase:', error.message);
    return Array.from(memoryRooms.values()).map(r => {
      const pieces = memoryPieces.get(r.roomId) || [];
      const snappedCount = pieces.filter((p: any) => p.is_snapped).length;
      const currentPlayers = io ? (io.sockets.adapter.rooms.get(`room_${r.roomId}`)?.size || 0) : 0;
      return { ...r, snappedCount, totalPieces: r.cols * r.rows, hasPassword: !!r.password, currentPlayers, playTime: roomPlayTimes.get(r.roomId) || 0, isCompleted: roomCompleted.has(r.roomId) };
    }).sort((a, b) => b.createdAt - a.createdAt);
  }
  
  const rooms = data.map(r => {
    if (!roomPlayTimes.has(r.id)) roomPlayTimes.set(r.id, r.play_time || 0);
    if (r.is_completed) roomCompleted.add(r.id);
    return {
      roomId: r.id,
      name: r.name,
      imageUrl: r.image_url,
      gridSize: r.grid_size,
      cols: r.cols,
      rows: r.rows,
      creator: r.creator,
      createdAt: Number(r.created_at),
      maxPlayers: r.max_players || 8,
      hasPassword: !!r.password,
      playTime: roomPlayTimes.get(r.id) || 0,
      isCompleted: roomCompleted.has(r.id)
    };
  });

  // Fetch progress for each room
  const roomsWithProgress = await Promise.all(rooms.map(async (r) => {
    const { count, error: countError } = await supabase
      .from('puzzle_pieces')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', r.roomId)
      .eq('is_snapped', true);
      
    if (countError) {
      console.error(`Error fetching progress for room ${r.roomId}:`, countError.message);
    }
    
    const currentPlayers = io ? (io.sockets.adapter.rooms.get(`room_${r.roomId}`)?.size || 0) : 0;
    
    return {
      ...r,
      snappedCount: count || 0,
      totalPieces: (r.cols && r.rows) ? (r.cols * r.rows) : r.gridSize,
      currentPlayers
    };
  }));

  return roomsWithProgress;
}

async function getPiecesFromDB(roomId: string) {
  if (!supabase) {
    return memoryPieces.get(roomId) || [];
  }
  const { data, error } = await supabase.from('puzzle_pieces').select('*').eq('room_id', roomId);
  if (error) {
    console.error('Error fetching pieces from Supabase:', error.message);
    return memoryPieces.get(roomId) || [];
  }
  return data.map(p => ({
    piece_id: p.piece_id,
    current_x: p.current_x,
    current_y: p.current_y,
    is_snapped: p.is_snapped,
    locked_by: p.locked_by
  }));
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.use(cors());
  app.use(express.json());

  // Populate roomPlayTimes from Supabase on startup
  if (supabase) {
    await getRoomsFromDB();
  }

  // Socket.io logic
  const runTimer = async () => {
    try {
      const updates: { roomId: string, playTime: number }[] = [];
      for (const [roomIdStr, room] of io.sockets.adapter.rooms.entries()) {
        if (roomIdStr.startsWith('room_') && room.size > 0) {
          const roomId = roomIdStr.replace('room_', '');
          if (!roomCompleted.has(roomId)) {
            const currentPlayTime = (roomPlayTimes.get(roomId) || 0) + 1;
            roomPlayTimes.set(roomId, currentPlayTime);
            updates.push({ roomId, playTime: currentPlayTime });
          }
        }
      }

      for (const update of updates) {
        io.to(`room_${update.roomId}`).emit('play_time_update', update.playTime);
        
        // Save to DB every 10 seconds
        if (update.playTime % 10 === 0 && supabase) {
          supabase.from('puzzle_rooms').update({ play_time: update.playTime }).eq('id', update.roomId).then(({error}) => {
            if (error) console.error('Error saving play time:', error.message);
          });
        }
      }
    } catch (error) {
      console.error('Error in runTimer:', error);
    }
    setTimeout(runTimer, 1000);
  };
  setTimeout(runTimer, 1000);

  io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);

    // Send current rooms to the newly connected user
    const initialRooms = await getRoomsFromDB(io);
    socket.emit('rooms_list', initialRooms);

    socket.on('get_rooms', async () => {
      const rooms = await getRoomsFromDB(io);
      socket.emit('rooms_list', rooms);
    });

    socket.on('create_room', async (roomData: any, callback?: (res: any) => void) => {
      let useMemory = !supabase;
      if (supabase) {
        const { error } = await supabase.from('puzzle_rooms').insert({
          id: roomData.id,
          name: roomData.name,
          image_url: roomData.imageUrl,
          grid_size: roomData.gridSize,
          cols: roomData.cols,
          rows: roomData.rows,
          creator: roomData.creator,
          created_at: roomData.createdAt,
          max_players: roomData.maxPlayers || 8,
          password: roomData.password || null
        });
        if (error) {
          console.error('Error creating room in Supabase:', error.message);
          useMemory = true; // Fallback if RLS or other error blocks insert
        }
      }
      
      if (useMemory) {
        memoryRooms.set(roomData.id, {
          roomId: roomData.id,
          name: roomData.name,
          imageUrl: roomData.imageUrl,
          gridSize: roomData.gridSize,
          cols: roomData.cols,
          rows: roomData.rows,
          creator: roomData.creator,
          createdAt: roomData.createdAt,
          maxPlayers: roomData.maxPlayers || 8,
          password: roomData.password || null
        });
        memoryPieces.set(roomData.id, []);
      }
      
      const rooms = await getRoomsFromDB(io);
      io.emit('rooms_list', rooms);
      
      if (callback) callback({ success: true });
    });

    socket.on('join_room', async (payload: any, callback?: (res: any) => void) => {
      const roomId = typeof payload === 'string' ? payload : payload.roomId;
      const password = typeof payload === 'string' ? undefined : payload.password;
      
      let roomData = null;
      let useMemory = !supabase;

      if (supabase) {
        const { data, error } = await supabase.from('puzzle_rooms').select('*').eq('id', roomId).single();
        if (error) {
          console.error('Error joining room in Supabase:', error.message);
          useMemory = true;
        } else if (data) {
          roomData = data;
        }
      }

      if (useMemory && memoryRooms.has(roomId)) {
        const memRoom = memoryRooms.get(roomId);
        roomData = {
          id: memRoom.roomId,
          name: memRoom.name,
          image_url: memRoom.imageUrl,
          grid_size: memRoom.gridSize,
          cols: memRoom.cols,
          rows: memRoom.rows,
          creator: memRoom.creator,
          created_at: memRoom.createdAt,
          max_players: memRoom.maxPlayers,
          password: memRoom.password
        };
      }

      if (!roomData) {
        if (callback) callback({ success: false, message: 'Room not found' });
        return;
      }

      const currentPlayers = io.sockets.adapter.rooms.get(`room_${roomId}`)?.size || 0;
      const maxPlayers = roomData.max_players || 8;
      
      // Allow joining if already in the room (e.g. reconnecting)
      const isAlreadyInRoom = socket.rooms.has(`room_${roomId}`);
      if (!isAlreadyInRoom && currentPlayers >= maxPlayers) {
        if (callback) callback({ success: false, message: 'Room is full' });
        return;
      }

      if (roomData.password && roomData.password !== password) {
        if (callback) callback({ success: false, message: 'Incorrect password' });
        return;
      }

      socket.join(`room_${roomId}`);
      
      const room = {
        id: roomData.id,
        name: roomData.name,
        imageUrl: roomData.image_url,
        gridSize: roomData.grid_size,
        cols: roomData.cols,
        rows: roomData.rows,
        creator: roomData.creator,
        createdAt: Number(roomData.created_at),
        pieces: await getPiecesFromDB(roomId),
        playTime: roomPlayTimes.get(roomId) || 0
      };

      socket.emit('room_state', room);
      if (callback) callback({ success: true });

      const count = io.sockets.adapter.rooms.get(`room_${roomId}`)?.size || 0;
      io.to(`room_${roomId}`).emit('player_count', count);
      
      const rooms = await getRoomsFromDB(io);
      io.emit('rooms_list', rooms);
    });

    socket.on('leave_room', async (roomId: string) => {
      socket.leave(`room_${roomId}`);
      const count = io.sockets.adapter.rooms.get(`room_${roomId}`)?.size || 0;
      io.to(`room_${roomId}`).emit('player_count', count);
      
      const rooms = await getRoomsFromDB(io);
      io.emit('rooms_list', rooms);
    });

    socket.on('get_pieces', async (roomId: string) => {
      const pieces = await getPiecesFromDB(roomId);
      socket.emit('pieces_state', pieces);
    });

    socket.on('upsert_pieces', async ({ roomId, pieces }: { roomId: string, pieces: any[] }) => {
      if (!pieces || pieces.length === 0) return;
      
      let useMemory = !supabase;

      if (supabase) {
        // 200개씩 배치 처리하여 데이터베이스 요청 크기 제한 문제 해결
        const BATCH_SIZE = 200;
        for (let i = 0; i < pieces.length; i += BATCH_SIZE) {
          const batch = pieces.slice(i, i + BATCH_SIZE);
          const upsertData = batch.map(p => ({
            room_id: roomId,
            piece_id: p.piece_id,
            current_x: p.current_x,
            current_y: p.current_y,
            is_snapped: p.is_snapped,
            locked_by: p.locked_by
          }));

          const { error } = await supabase.from('puzzle_pieces').upsert(upsertData, { onConflict: 'room_id,piece_id' });
          if (error) {
            console.error(`Error upserting pieces batch ${i} in Supabase:`, error.message);
            useMemory = true;
            break; // 하나라도 실패하면 전체 실패로 간주하고 메모리 폴백
          }
        }
      }

      if (useMemory) {
        const roomPieces = memoryPieces.get(roomId) || [];
        for (const p of pieces) {
          const idx = roomPieces.findIndex((rp: any) => rp.piece_id === p.piece_id);
          if (idx !== -1) {
            roomPieces[idx] = { ...roomPieces[idx], ...p };
          } else {
            roomPieces.push(p);
          }
        }
        memoryPieces.set(roomId, roomPieces);
      }
    });

    socket.on('delete_pieces', async ({ roomId, pieceIds }: { roomId: string, pieceIds: number[] }) => {
      if (!pieceIds || pieceIds.length === 0) return;
      
      let useMemory = !supabase;

      if (supabase) {
        const { error } = await supabase.from('puzzle_pieces').delete().eq('room_id', roomId).in('piece_id', pieceIds);
        if (error) {
          console.error('Error deleting pieces in Supabase:', error.message);
          useMemory = true;
        }
      }

      if (useMemory) {
        let roomPieces = memoryPieces.get(roomId) || [];
        roomPieces = roomPieces.filter((p: any) => !pieceIds.includes(p.piece_id));
        memoryPieces.set(roomId, roomPieces);
      }
    });

    socket.on('puzzle_completed', async (roomId: string) => {
      console.log('Puzzle completed for room:', roomId);
      if (!roomCompleted.has(roomId)) {
        roomCompleted.add(roomId);
        if (supabase) {
          try {
            const playTime = roomPlayTimes.get(roomId) || 0;
            console.log('Saving completed play time to DB:', playTime);
            const { error } = await supabase.from('puzzle_rooms').update({ is_completed: true, play_time: playTime }).eq('id', roomId);
            if (error) {
              console.error('Error saving completed play time to Supabase:', error.message);
            } else {
              console.log('Successfully saved completed play time to DB');
            }
          } catch (e) {
            console.error('Exception saving completed play time to Supabase:', e);
          }
        }
        io.to(`room_${roomId}`).emit('puzzle_completed_broadcast');
        const rooms = await getRoomsFromDB(io);
        io.emit('rooms_list', rooms);
      }
    });

    socket.on('get_score', async ({ roomId, username }: { roomId: string, username: string }) => {
      let score = 0;
      
      if (supabase) {
        const { data, error } = await supabase
          .from('puzzle_scores')
          .select('score')
          .eq('room_id', roomId)
          .eq('username', username)
          .single();
          
        if (!error && data) {
          score = data.score || 0;
        } else {
          const mem = memoryScores.get(`${roomId}_${username}`);
          if (mem) {
            score = mem.score || 0;
          }
        }
      } else {
        const mem = memoryScores.get(`${roomId}_${username}`);
        if (mem) {
          score = mem.score || 0;
        }
      }
      
      socket.emit('score_state', { score });
    });

    const broadcastAllScores = async (roomId: string) => {
      let scores: any[] = [];
      if (supabase) {
        const { data, error } = await supabase
          .from('puzzle_scores')
          .select('username, score')
          .eq('room_id', roomId);
        if (!error && data) {
          scores = data.map(d => ({ ...d, score: d.score || 0 }));
        }
      } else {
        for (const [key, val] of memoryScores.entries()) {
          if (key.startsWith(`${roomId}_`)) {
            const username = key.replace(`${roomId}_`, '');
            scores.push({ username, score: val.score || 0 });
          }
        }
      }
      io.to(`room_${roomId}`).emit('all_scores', scores);
    };

    socket.on('get_all_scores', async (roomId: string) => {
      await broadcastAllScores(roomId);
    });

    socket.on('update_score', async ({ roomId, username, score }: { roomId: string, username: string, score: number }) => {
      if (supabase) {
        const { error } = await supabase
          .from('puzzle_scores')
          .upsert({
            room_id: roomId,
            username: username,
            score: score
          }, { onConflict: 'room_id,username' });
          
        if (error) {
          console.error('Error upserting score:', error.message);
        }
      }
      memoryScores.set(`${roomId}_${username}`, { score });
      await broadcastAllScores(roomId);
    });

    socket.on('broadcast', (payload: any) => {
      // payload should have { roomId, event, payload }
      socket.to(`room_${payload.roomId}`).emit('broadcast', payload);
    });

    socket.on('disconnecting', async () => {
      for (const room of socket.rooms) {
        if (room.startsWith('room_')) {
          const roomId = room.replace('room_', '');
          const count = (io.sockets.adapter.rooms.get(room)?.size || 1) - 1;
          io.to(room).emit('player_count', count);
        }
      }
    });

    socket.on('disconnect', async () => {
      console.log('User disconnected:', socket.id);
      const rooms = await getRoomsFromDB(io);
      io.emit('rooms_list', rooms);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
