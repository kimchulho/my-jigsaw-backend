import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';

// Types
interface Piece {
  id: number;
  x: number;
  y: number;
  is_snapped: boolean;
}

interface Room {
  id: string;
  name: string;
  imageUrl: string;
  gridSize: number;
  cols: number;
  rows: number;
  creator: string;
  pieces: Piece[];
  createdAt: number;
}

// In-memory store for speed
const rooms = new Map<string, Room>();

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.use(cors());
  app.use(express.json());

  // Socket.io logic
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send current rooms to the newly connected user
    socket.emit('rooms_list', Array.from(rooms.values()).map(r => ({
      roomId: r.id,
      name: r.name,
      imageUrl: r.imageUrl,
      gridSize: r.gridSize,
      cols: r.cols,
      rows: r.rows,
      creator: r.creator,
      createdAt: r.createdAt
    })));

    socket.on('get_rooms', () => {
      socket.emit('rooms_list', Array.from(rooms.values()).map(r => ({
        roomId: r.id,
        name: r.name,
        imageUrl: r.imageUrl,
        gridSize: r.gridSize,
        cols: r.cols,
        rows: r.rows,
        creator: r.creator,
        createdAt: r.createdAt
      })));
    });

    socket.on('create_room', (roomData: any) => {
      rooms.set(roomData.id, roomData);
      io.emit('rooms_list', Array.from(rooms.values()).map(r => ({
        roomId: r.id,
        name: r.name,
        imageUrl: r.imageUrl,
        gridSize: r.gridSize,
        cols: r.cols,
        rows: r.rows,
        creator: r.creator,
        createdAt: r.createdAt
      })));
    });

    socket.on('join_room', (roomId: string) => {
      socket.join(`room_${roomId}`);
      const room = rooms.get(roomId);
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

    socket.on('get_pieces', (roomId: string) => {
      const room = rooms.get(roomId);
      if (room) {
        socket.emit('pieces_state', room.pieces);
      } else {
        socket.emit('pieces_state', []);
      }
    });

    socket.on('upsert_pieces', ({ roomId, pieces }: { roomId: string, pieces: any[] }) => {
      const room = rooms.get(roomId);
      if (room) {
        // Update or insert pieces
        for (const p of pieces) {
          const idx = room.pieces.findIndex((rp: any) => rp.piece_id === p.piece_id);
          if (idx !== -1) {
            room.pieces[idx] = { ...room.pieces[idx], ...p };
          } else {
            room.pieces.push(p);
          }
        }
      }
    });

    socket.on('delete_pieces', ({ roomId, pieceIds }: { roomId: string, pieceIds: number[] }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.pieces = room.pieces.filter((p: any) => !pieceIds.includes(p.piece_id));
      }
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
