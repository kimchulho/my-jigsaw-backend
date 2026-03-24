import { io } from 'socket.io-client';

// Connect to the same host that serves the frontend, or use VITE_BACKEND_URL if provided
const backendUrl = import.meta.env.VITE_BACKEND_URL || undefined;

export const socket = io(backendUrl, {
  autoConnect: true,
  transports: ['websocket', 'polling']
});
