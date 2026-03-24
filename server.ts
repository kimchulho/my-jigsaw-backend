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

async function getRoomsFromDB() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('puzzle_rooms').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching rooms:', error);
    return [];
  }
  return data.map(r => ({
    roomId: r.id,
    name: r.name,
    imageUrl: r.image_url,
    gridSize: r.grid_size,
    cols: r.cols,
    rows: r.rows,
    creator: r.creator,
    createdAt: Number(r.created_at)
  }));
}

async function getPiecesFromDB(roomId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('puzzle_pieces').select('*').eq('room_id', roomId);
  if (error) {
    console.error('Error fetching pieces:', error);
    return [];
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
        if (error) console.error('Error creating room:', error);
      }
      
      const rooms = await getRoomsFromDB();
      io.emit('rooms_list', rooms);
    });

    socket.on('join_room', async (roomId: string) => {
      socket.join(`room_${roomId}`);
      
      if (supabase) {
        const { data } = await supabase.from('puzzle_rooms').select('*').eq('id', roomId).single();
        if (data) {
          const room = {
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
          socket.emit('room_state', room);
        }
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
      if (!supabase || !pieces || pieces.length === 0) return;
      
      const upsertData = pieces.map(p => ({
        room_id: roomId,
        piece_id: p.piece_id,
        current_x: p.current_x,
        current_y: p.current_y,
        is_snapped: p.is_snapped,
        locked_by: p.locked_by
      }));

      const { error } = await supabase.from('puzzle_pieces').upsert(upsertData, { onConflict: 'room_id,piece_id' });
      if (error) console.error('Error upserting pieces:', error);
    });

    socket.on('delete_pieces', async ({ roomId, pieceIds }: { roomId: string, pieceIds: number[] }) => {
      if (!supabase || !pieceIds || pieceIds.length === 0) return;
      const { error } = await supabase.from('puzzle_pieces').delete().eq('room_id', roomId).in('piece_id', pieceIds);
      if (error) console.error('Error deleting pieces:', error);
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
