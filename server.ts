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

async function getRoomsFromDB() {
  if (!supabase) {
    return Array.from(memoryRooms.values()).map(r => {
      const pieces = memoryPieces.get(r.roomId) || [];
      const snappedCount = pieces.filter((p: any) => p.is_snapped).length;
      return { ...r, snappedCount, totalPieces: r.cols * r.rows };
    }).sort((a, b) => b.createdAt - a.createdAt);
  }
  const { data, error } = await supabase.from('puzzle_rooms').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching rooms from Supabase:', error.message);
    return Array.from(memoryRooms.values()).map(r => {
      const pieces = memoryPieces.get(r.roomId) || [];
      const snappedCount = pieces.filter((p: any) => p.is_snapped).length;
      return { ...r, snappedCount, totalPieces: r.cols * r.rows };
    }).sort((a, b) => b.createdAt - a.createdAt);
  }
  
  const rooms = data.map(r => ({
    roomId: r.id,
    name: r.name,
    imageUrl: r.image_url,
    gridSize: r.grid_size,
    cols: r.cols,
    rows: r.rows,
    creator: r.creator,
    createdAt: Number(r.created_at)
  }));

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
    
    return {
      ...r,
      snappedCount: count || 0,
      totalPieces: (r.cols && r.rows) ? (r.cols * r.rows) : r.gridSize
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

  // Socket.io logic
  io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);

    // Send current rooms to the newly connected user
    const initialRooms = await getRoomsFromDB();
    socket.emit('rooms_list', initialRooms);

    socket.on('get_rooms', async () => {
      const rooms = await getRoomsFromDB();
      socket.emit('rooms_list', rooms);
    });

    socket.on('create_room', async (roomData: any) => {
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
          created_at: roomData.createdAt
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
          createdAt: roomData.createdAt
        });
        memoryPieces.set(roomData.id, []);
      }
      
      const rooms = await getRoomsFromDB();
      io.emit('rooms_list', rooms);
    });

    socket.on('join_room', async (roomId: string) => {
      socket.join(`room_${roomId}`);
      
      let room = null;
      let useMemory = !supabase;

      if (supabase) {
        const { data, error } = await supabase.from('puzzle_rooms').select('*').eq('id', roomId).single();
        if (error) {
          console.error('Error joining room in Supabase:', error.message);
          useMemory = true;
        } else if (data) {
          room = {
            id: data.id,
            name: data.name,
            imageUrl: data.image_url,
            gridSize: data.grid_size,
            cols: data.cols,
            rows: data.rows,
            creator: data.creator,
            createdAt: Number(data.created_at),
            pieces: await getPiecesFromDB(roomId)
          };
        }
      }

      if (useMemory && memoryRooms.has(roomId)) {
        const memRoom = memoryRooms.get(roomId);
        room = {
          id: memRoom.roomId,
          name: memRoom.name,
          imageUrl: memRoom.imageUrl,
          gridSize: memRoom.gridSize,
          cols: memRoom.cols,
          rows: memRoom.rows,
          creator: memRoom.creator,
          createdAt: memRoom.createdAt,
          pieces: await getPiecesFromDB(roomId)
        };
      }

      if (room) {
        socket.emit('room_state', room);
      }

      const count = io.sockets.adapter.rooms.get(`room_${roomId}`)?.size || 0;
      io.to(`room_${roomId}`).emit('player_count', count);
    });

    socket.on('leave_room', (roomId: string) => {
      socket.leave(`room_${roomId}`);
      const count = io.sockets.adapter.rooms.get(`room_${roomId}`)?.size || 0;
      io.to(`room_${roomId}`).emit('player_count', count);
    });

    socket.on('get_pieces', async (roomId: string) => {
      const pieces = await getPiecesFromDB(roomId);
      socket.emit('pieces_state', pieces);
    });

    socket.on('upsert_pieces', async ({ roomId, pieces }: { roomId: string, pieces: any[] }) => {
      if (!pieces || pieces.length === 0) return;
      
      let useMemory = !supabase;

      if (supabase) {
        const upsertData = pieces.map(p => ({
          room_id: roomId,
          piece_id: p.piece_id,
          current_x: p.current_x,
          current_y: p.current_y,
          is_snapped: p.is_snapped,
          locked_by: p.locked_by
        }));

        const { error } = await supabase.from('puzzle_pieces').upsert(upsertData, { onConflict: 'room_id,piece_id' });
        if (error) {
          console.error('Error upserting pieces in Supabase:', error.message);
          useMemory = true;
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
          score = data.score;
        } else {
          const mem = memoryScores.get(`${roomId}_${username}`);
          if (mem) {
            score = mem.score;
          }
        }
      } else {
        const mem = memoryScores.get(`${roomId}_${username}`);
        if (mem) {
          score = mem.score;
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
          scores = data;
        }
      } else {
        for (const [key, val] of memoryScores.entries()) {
          if (key.startsWith(`${roomId}_`)) {
            const username = key.replace(`${roomId}_`, '');
            scores.push({ username, score: val.score });
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

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('room_')) {
          const roomId = room.replace('room_', '');
          const count = (io.sockets.adapter.rooms.get(room)?.size || 1) - 1;
          io.to(room).emit('player_count', count);
        }
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
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
