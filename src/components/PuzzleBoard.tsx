"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';
import { v4 as uuidv4 } from 'uuid';
import { Loader2 } from 'lucide-react';
import { getPiecePath, TAB_SIZE_RATIO } from '../utils/puzzleShapes';
import confetti from 'canvas-confetti';
import { Stage, Layer, Group, Path, Image as KonvaImage, Rect } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';

const SNAP_DISTANCE = 30;

interface PuzzlePiece {
  piece_id: number;
  current_x: number;
  current_y: number;
  locked_by: string | null;
  is_snapped: boolean;
}

interface RoomConfig {
  roomId: string;
  imageUrl: string;
  cols: number;
  rows: number;
}

interface PuzzleBoardProps {
  onBack?: () => void;
  username: string;
  roomConfig: RoomConfig;
}

export default function PuzzleBoard({ onBack, username, roomConfig }: PuzzleBoardProps) {
  const GRID_COLS = roomConfig.cols;
  const GRID_ROWS = roomConfig.rows;
  const IMAGE_URL = roomConfig.imageUrl;
  
  const PIECE_WIDTH = 100;
  const PIECE_HEIGHT = 100;
  const BOARD_WIDTH = GRID_COLS * PIECE_WIDTH;
  const BOARD_HEIGHT = GRID_ROWS * PIECE_HEIGHT;
  const parsedRoomId = parseInt(roomConfig.roomId, 10);
  const ROOM_OFFSET = isNaN(parsedRoomId) ? 0 : parsedRoomId * 10000;

  const [image] = useImage(IMAGE_URL, 'anonymous');

  const getColRow = useCallback((id: number) => {
    const i = id % 10000;
    return { col: i % GRID_COLS, row: Math.floor(i / GRID_COLS) };
  }, [GRID_COLS]);

  const [pieces, setPieces] = useState<PuzzlePiece[]>([]);
  const [userId] = useState(() => uuidv4());
  const [isReady, setIsReady] = useState(false);
  
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  
  const [playerCount, setPlayerCount] = useState(1);
  const [boardScore, setBoardScore] = useState(0);
  const [connectionScore, setConnectionScore] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  
  const lastCenter = useRef<{x: number, y: number} | null>(null);
  const lastDist = useRef<number>(0);

  const draggingGroupRef = useRef<number[]>([]);
  const lastBroadcastRef = useRef<number>(0);
  const piecesRef = useRef<PuzzlePiece[]>([]);

  const getConnectedGroup = (startId: number, allPieces: PuzzlePiece[]) => {
    const group = new Set<number>([startId]);
    const queue = [startId];
    const pieceMap = new Map(allPieces.map(p => [p.piece_id, p]));
    
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const currP = pieceMap.get(currId);
      if (!currP) continue;
      
      const { col: currCol, row: currRow } = getColRow(currId);
      
      for (const p of allPieces) {
        if (group.has(p.piece_id)) continue;
        
        const { col: pCol, row: pRow } = getColRow(p.piece_id);
        const isAdjacent = Math.abs(currCol - pCol) + Math.abs(currRow - pRow) === 1;
        if (!isAdjacent) continue;
        
        const expected_dx = (pCol - currCol) * PIECE_WIDTH;
        const expected_dy = (pRow - currRow) * PIECE_HEIGHT;
        const actual_dx = p.current_x - currP.current_x;
        const actual_dy = p.current_y - currP.current_y;
        
        if (Math.abs(expected_dx - actual_dx) < 1 && Math.abs(expected_dy - actual_dy) < 1) {
          group.add(p.piece_id);
          queue.push(p.piece_id);
        }
      }
    }
    return Array.from(group);
  };

  useEffect(() => {
    piecesRef.current = pieces;
  }, [pieces]);

  // Center the camera on mount
  useEffect(() => {
    setStagePos({
      x: window.innerWidth / 2 - BOARD_WIDTH / 2,
      y: window.innerHeight / 2 - BOARD_HEIGHT / 2,
    });
  }, [BOARD_WIDTH, BOARD_HEIGHT]);

  // Handle window resize
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize pieces from DB
  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    socket.emit('join_room', roomConfig.roomId);

    const handlePiecesState = (data: any[]) => {
      if (data && data.length > 0) {
        const roomPieces = data.filter(p => p.piece_id >= ROOM_OFFSET && p.piece_id < ROOM_OFFSET + 10000);
        
        if (roomPieces.length === GRID_COLS * GRID_ROWS) {
          const processedData = roomPieces.map(p => {
            const { col, row } = getColRow(p.piece_id);
            const targetX = col * PIECE_WIDTH;
            const targetY = row * PIECE_HEIGHT;
            const is_snapped = Math.abs(p.current_x - targetX) < 1 && Math.abs(p.current_y - targetY) < 1;
            return { ...p, is_snapped };
          });
          setPieces(processedData);
        } else {
          if (roomPieces.length > 0) {
            const extraIds = roomPieces.map(p => p.piece_id);
            socket.emit('delete_pieces', { roomId: roomConfig.roomId, pieceIds: extraIds });
          }
          initializeNewPieces();
        }
      } else {
        initializeNewPieces();
      }
      setIsReady(true);
    };

    const initializeNewPieces = () => {
      const initialPieces: PuzzlePiece[] = [];
      const centerX = BOARD_WIDTH / 2;
      const centerY = BOARD_HEIGHT / 2;

      for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
        const radius = Math.min(BOARD_WIDTH, BOARD_HEIGHT) / 2 + Math.min(PIECE_WIDTH, PIECE_HEIGHT) / 2 + 50 + Math.random() * 250;
        const angle = Math.random() * Math.PI * 2;

        initialPieces.push({
          piece_id: ROOM_OFFSET + i,
          current_x: centerX + Math.cos(angle) * radius - (PIECE_WIDTH / 2),
          current_y: centerY + Math.sin(angle) * radius - (PIECE_HEIGHT / 2),
          locked_by: null,
          is_snapped: false,
        });
      }
      socket.emit('upsert_pieces', { roomId: roomConfig.roomId, pieces: initialPieces });
      setPieces(initialPieces);
    };

    socket.on('pieces_state', handlePiecesState);
    socket.emit('get_pieces', roomConfig.roomId);

    return () => {
      socket.off('pieces_state', handlePiecesState);
    };
  }, [roomConfig.roomId, GRID_COLS, GRID_ROWS, ROOM_OFFSET, BOARD_WIDTH, BOARD_HEIGHT, getColRow]);

  // Realtime subscription
  useEffect(() => {
    const handleBroadcast = (payload: any) => {
      if (payload.event === 'cursor-pos') {
        const { pieces: updatedPieces, locked_by } = payload.payload;
        if (locked_by !== userId) {
          const conflict = updatedPieces.some((up: any) => draggingGroupRef.current.includes(up.piece_id));
          if (conflict) {
            if (userId < locked_by) return;
            else draggingGroupRef.current = [];
          }
          
          setPieces((prev) => {
            const newPieces = [...prev];
            for (const up of updatedPieces) {
              const idx = newPieces.findIndex(p => p.piece_id === up.piece_id);
              if (idx !== -1) {
                newPieces[idx] = { ...newPieces[idx], current_x: up.current_x, current_y: up.current_y, locked_by };
              }
            }
            return newPieces;
          });
        }
      } else if (payload.event === 'piece-lock') {
        const { piece_ids, locked_by } = payload.payload;
        if (locked_by !== userId) {
          const conflict = piece_ids.some((id: number) => draggingGroupRef.current.includes(id));
          if (conflict) {
            if (userId < locked_by) {
              socket.emit('broadcast', {
                roomId: roomConfig.roomId,
                event: 'piece-lock',
                payload: { piece_ids: draggingGroupRef.current, locked_by: userId },
              });
              return;
            } else {
              draggingGroupRef.current = [];
            }
          }
          setPieces((prev) => {
            const unselected = prev.filter(p => !piece_ids.includes(p.piece_id));
            const selected = prev.filter(p => piece_ids.includes(p.piece_id)).map(p => ({ ...p, locked_by }));
            return [...unselected, ...selected];
          });
        }
      } else if (payload.event === 'piece-drop') {
        const { pieces: droppedPieces } = payload.payload;
        setPieces((prev) => {
          const newPieces = [...prev];
          for (const dp of droppedPieces) {
            const idx = newPieces.findIndex(p => p.piece_id === dp.piece_id);
            if (idx !== -1) {
              newPieces[idx] = { ...newPieces[idx], current_x: dp.current_x, current_y: dp.current_y, locked_by: dp.locked_by, is_snapped: dp.is_snapped };
            }
          }
          return newPieces;
        });
      } else if (payload.event === 'board-reset') {
        setPieces(payload.payload.pieces);
      } else if (payload.event === 'request-sync') {
        const { from } = payload.payload;
        if (from !== userId && piecesRef.current.length === GRID_COLS * GRID_ROWS) {
          socket.emit('broadcast', {
            roomId: roomConfig.roomId,
            event: 'sync-state',
            payload: { to: from, pieces: piecesRef.current }
          });
        }
      } else if (payload.event === 'sync-state') {
        const { to, pieces: syncPieces } = payload.payload;
        if (to === userId && syncPieces && syncPieces.length === GRID_COLS * GRID_ROWS) {
          const processed = syncPieces.map((p: PuzzlePiece) => {
            const { col, row } = getColRow(p.piece_id);
            const targetX = col * PIECE_WIDTH;
            const targetY = row * PIECE_HEIGHT;
            const is_snapped = Math.abs(p.current_x - targetX) < 1 && Math.abs(p.current_y - targetY) < 1;
            return { ...p, is_snapped };
          });
          setPieces(processed);
        }
      }
    };

    socket.on('broadcast', handleBroadcast);
    socket.on('player_count', setPlayerCount);

    socket.emit('broadcast', {
      roomId: roomConfig.roomId,
      event: 'request-sync',
      payload: { from: userId }
    });

    return () => {
      socket.off('broadcast', handleBroadcast);
      socket.off('player_count', setPlayerCount);
      socket.emit('leave_room', roomConfig.roomId);
    };
  }, [userId, roomConfig.roomId, GRID_COLS, GRID_ROWS, getColRow]);

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>, piece: PuzzlePiece) => {
    const evt = e.evt as any;
    if (evt && evt.touches && evt.touches.length > 1) {
      e.target.stopDrag();
      return;
    }

    if (piece.is_snapped || (piece.locked_by && piece.locked_by !== userId)) {
      e.target.stopDrag();
      return;
    }

    const groupIds = getConnectedGroup(piece.piece_id, piecesRef.current);
    draggingGroupRef.current = groupIds;

    setPieces((prev) => {
      const unselected = prev.filter(p => !groupIds.includes(p.piece_id));
      const selected = prev.filter(p => groupIds.includes(p.piece_id)).map(p => ({ ...p, locked_by: userId }));
      return [...unselected, ...selected];
    });

    socket.emit('broadcast', {
      roomId: roomConfig.roomId,
      event: 'piece-lock',
      payload: { piece_ids: groupIds, locked_by: userId },
    });
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const groupIds = draggingGroupRef.current;
    if (groupIds.length === 0) return;

    const targetNode = e.target;
    const pieceIdStr = targetNode.id().replace('piece-', '');
    const draggedPieceId = parseInt(pieceIdStr, 10);
    
    const draggedPiece = piecesRef.current.find(p => p.piece_id === draggedPieceId);
    if (!draggedPiece) return;

    const newX = targetNode.x();
    const newY = targetNode.y();
    const deltaX = newX - draggedPiece.current_x;
    const deltaY = newY - draggedPiece.current_y;

    const updatedPieces: {piece_id: number, current_x: number, current_y: number}[] = [];

    for (const p of piecesRef.current) {
      if (groupIds.includes(p.piece_id)) {
        updatedPieces.push({ 
          piece_id: p.piece_id, 
          current_x: p.current_x + deltaX, 
          current_y: p.current_y + deltaY 
        });
        
        // Update other nodes in the group visually
        if (p.piece_id !== draggedPieceId) {
          const node = targetNode.getLayer()?.findOne(`#piece-${p.piece_id}`);
          if (node) {
            node.position({ x: p.current_x + deltaX, y: p.current_y + deltaY });
          }
        }
      }
    }

    const now = Date.now();
    if (now - lastBroadcastRef.current > 33) {
      socket.emit('broadcast', {
        roomId: roomConfig.roomId,
        event: 'cursor-pos',
        payload: { pieces: updatedPieces, locked_by: userId },
      });
      lastBroadcastRef.current = now;
    }
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const groupIds = draggingGroupRef.current;
    if (groupIds.length === 0) return;

    draggingGroupRef.current = [];

    const targetNode = e.target;
    const pieceIdStr = targetNode.id().replace('piece-', '');
    const draggedPieceId = parseInt(pieceIdStr, 10);
    
    const firstPiece = piecesRef.current.find(p => p.piece_id === draggedPieceId);
    if (!firstPiece || firstPiece.locked_by !== userId) return;

    const newX = targetNode.x();
    const newY = targetNode.y();
    const deltaX = newX - firstPiece.current_x;
    const deltaY = newY - firstPiece.current_y;

    let dx = 0;
    let dy = 0;
    let isSnapped = false;
    let snappedToAdjacent = false;

    const { col, row } = getColRow(draggedPieceId);
    const targetBoardX = col * PIECE_WIDTH;
    const targetBoardY = row * PIECE_HEIGHT;

    const distanceToBoard = Math.sqrt(
      Math.pow(newX - targetBoardX, 2) + Math.pow(newY - targetBoardY, 2)
    );

    if (distanceToBoard < SNAP_DISTANCE) {
      isSnapped = true;
      dx = targetBoardX - newX;
      dy = targetBoardY - newY;
    } else {
      // Check adjacent snaps
      for (const id of groupIds) {
        if (snappedToAdjacent) break;
        
        const p = piecesRef.current.find(p => p.piece_id === id);
        if (!p) continue;
        
        const currentPx = p.current_x + deltaX;
        const currentPy = p.current_y + deltaY;
        
        const { col: dCol, row: dRow } = getColRow(id);
        
        for (const otherP of piecesRef.current) {
          if (groupIds.includes(otherP.piece_id)) continue;
          
          const { col: oCol, row: oRow } = getColRow(otherP.piece_id);
          const isAdjacent = Math.abs(dCol - oCol) + Math.abs(dRow - oRow) === 1;
          if (!isAdjacent) continue;
          
          const expected_dx = (dCol - oCol) * PIECE_WIDTH;
          const expected_dy = (dRow - oRow) * PIECE_HEIGHT;
          
          const target_x = otherP.current_x + expected_dx;
          const target_y = otherP.current_y + expected_dy;
          
          const distance = Math.sqrt(
            Math.pow(currentPx - target_x, 2) + Math.pow(currentPy - target_y, 2)
          );
          
          if (distance < SNAP_DISTANCE) {
            snappedToAdjacent = true;
            dx = target_x - currentPx;
            dy = target_y - currentPy;
            if (otherP.is_snapped) isSnapped = true;
            break;
          }
        }
      }
    }

    const finalPieces: any[] = [];

    for (const p of piecesRef.current) {
      if (groupIds.includes(p.piece_id)) {
        const finalX = p.current_x + deltaX + dx;
        const finalY = p.current_y + deltaY + dy;
        
        if (isSnapped && !p.is_snapped) setBoardScore(s => s + 1);
        
        finalPieces.push({ 
          piece_id: p.piece_id, 
          current_x: finalX, 
          current_y: finalY, 
          locked_by: null, 
          is_snapped: p.is_snapped || isSnapped 
        });
      }
    }
    
    if (snappedToAdjacent) setConnectionScore(s => s + 1);

    setPieces((prev) =>
      prev.map((p) => {
        const fp = finalPieces.find(f => f.piece_id === p.piece_id);
        if (fp) {
          return { ...p, current_x: fp.current_x, current_y: fp.current_y, locked_by: null, is_snapped: isSnapped };
        }
        return p;
      })
    );

    socket.emit('broadcast', {
      roomId: roomConfig.roomId,
      event: 'piece-drop',
      payload: { pieces: finalPieces },
    });

    socket.emit('upsert_pieces', {
      roomId: roomConfig.roomId,
      pieces: finalPieces.map(fp => ({
        piece_id: fp.piece_id,
        current_x: fp.current_x,
        current_y: fp.current_y,
        locked_by: null,
        is_snapped: isSnapped,
      }))
    });
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const zoomSensitivity = 0.002;
    const newScale = Math.min(Math.max(0.1, oldScale - e.evt.deltaY * zoomSensitivity), 5);

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    stage.scaleX(newScale);
    stage.scaleY(newScale);
    stage.position(newPos);
    stage.batchDraw();

    setStageScale(newScale);
    setStagePos(newPos);
  };

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault();
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];

    if (touch1 && touch2) {
      const stage = stageRef.current;
      if (!stage) return;

      if (stage.isDragging()) {
        stage.stopDrag();
      }

      const p1 = { x: touch1.clientX, y: touch1.clientY };
      const p2 = { x: touch2.clientX, y: touch2.clientY };

      const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      const center = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      };

      if (!lastDist.current || !lastCenter.current) {
        lastDist.current = dist;
        lastCenter.current = center;
        return;
      }

      const currentScale = stage.scaleX();
      const scaleChange = dist / lastDist.current;
      const newScale = Math.min(Math.max(0.1, currentScale * scaleChange), 5);

      const dx = center.x - lastCenter.current.x;
      const dy = center.y - lastCenter.current.y;

      const newPos = {
        x: center.x - (center.x - stage.x()) * (newScale / currentScale) + dx,
        y: center.y - (center.y - stage.y()) * (newScale / currentScale) + dy,
      };

      stage.scaleX(newScale);
      stage.scaleY(newScale);
      stage.position(newPos);
      stage.batchDraw();

      lastDist.current = dist;
      lastCenter.current = center;

      setStageScale(newScale);
      setStagePos(newPos);
    } else {
      lastDist.current = 0;
      lastCenter.current = null;
    }
  };

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (!e.evt.touches || e.evt.touches.length < 2) {
      lastDist.current = 0;
      lastCenter.current = null;
    }
  };

  const completedCount = pieces.filter(p => p.is_snapped).length;
  const isCompleted = completedCount === GRID_COLS * GRID_ROWS && completedCount > 0;

  useEffect(() => {
    if (isCompleted) {
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval: any = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti({
          ...defaults, particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
        });
        confetti({
          ...defaults, particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
        });
      }, 250);

      return () => clearInterval(interval);
    }
  }, [isCompleted]);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-screen bg-slate-900 overflow-hidden touch-none font-sans"
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20 pointer-events-none">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Multiplayer Jigsaw</h1>
          <p className="text-slate-400 text-sm mt-1">Drag pieces to the board. Syncs in real-time.</p>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          {onBack && (
            <button 
              onClick={onBack}
              className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 text-slate-300 text-sm transition-colors"
            >
              Back
            </button>
          )}
          <button 
            onClick={async () => {
              const centerX = BOARD_WIDTH / 2;
              const centerY = BOARD_HEIGHT / 2;
              const resetPieces = pieces.map(p => {
                const radius = Math.min(BOARD_WIDTH, BOARD_HEIGHT) / 2 + Math.min(PIECE_WIDTH, PIECE_HEIGHT) / 2 + 50 + Math.random() * 250;
                const angle = Math.random() * Math.PI * 2;
                return {
                  ...p,
                  current_x: centerX + Math.cos(angle) * radius - (PIECE_WIDTH / 2),
                  current_y: centerY + Math.sin(angle) * radius - (PIECE_HEIGHT / 2),
                  locked_by: null,
                  is_snapped: false
                };
              });
              setPieces(resetPieces);
              socket.emit('broadcast', {
                roomId: roomConfig.roomId,
                event: 'board-reset',
                payload: { pieces: resetPieces },
              });
              socket.emit('upsert_pieces', { roomId: roomConfig.roomId, pieces: resetPieces });
            }}
            className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 text-slate-300 text-sm transition-colors"
          >
            Reset Puzzle
          </button>
          <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 flex items-center gap-2">
            <span className="text-indigo-400 font-medium text-sm">{username}</span>
            <span className="text-slate-500">|</span>
            <span className="text-white text-sm">Board: {boardScore}</span>
            <span className="text-white text-sm">Conn: {connectionScore}</span>
          </div>
          <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-white font-medium text-sm">{playerCount} Player{playerCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700">
            <span className="text-white font-medium">{completedCount} / {GRID_COLS * GRID_ROWS}</span>
            <span className="text-slate-400 ml-2 text-sm">Pieces Placed</span>
          </div>
        </div>
      </div>

      {isCompleted && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-slate-800/90 p-6 rounded-2xl border border-emerald-500/50 text-center shadow-[0_0_30px_rgba(16,185,129,0.2)] animate-in slide-in-from-top-10 duration-500">
            <h2 className="text-3xl font-bold text-emerald-400 mb-1">Puzzle Completed!</h2>
            <p className="text-slate-300">Great job collaborating. You can now admire your work.</p>
          </div>
        </div>
      )}

      {/* Konva Stage */}
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        draggable
        ref={stageRef}
      >
        <Layer>
          {/* Board Outline */}
          <Rect
            x={0}
            y={0}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            stroke="#334155"
            strokeWidth={2}
            dash={[10, 10]}
          />
          {image && (
            <KonvaImage
              image={image}
              x={0}
              y={0}
              width={BOARD_WIDTH}
              height={BOARD_HEIGHT}
              opacity={0.1}
            />
          )}

          {/* Pieces */}
          {pieces.map((piece) => {
            const { col, row } = getColRow(piece.piece_id);
            const tabSize = Math.min(PIECE_WIDTH, PIECE_HEIGHT) * TAB_SIZE_RATIO;
            const pathData = getPiecePath(col, row, GRID_COLS, GRID_ROWS, PIECE_WIDTH, PIECE_HEIGHT);

            const isLockedByOther = piece.locked_by && piece.locked_by !== userId;
            const isDragging = piece.locked_by === userId;

            return (
              <Group
                key={piece.piece_id}
                id={`piece-${piece.piece_id}`}
                x={piece.current_x}
                y={piece.current_y}
                draggable={!piece.is_snapped && !isLockedByOther}
                onDragStart={(e) => handleDragStart(e, piece)}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              >
                {/* Shadow */}
                {!piece.is_snapped && (
                  <Path
                    data={pathData}
                    x={-tabSize}
                    y={-tabSize}
                    fill="black"
                    opacity={isDragging ? 0.4 : 0.2}
                    shadowColor="black"
                    shadowBlur={isDragging ? 20 : 10}
                    shadowOffset={{ x: 0, y: isDragging ? 10 : 5 }}
                    shadowOpacity={0.5}
                  />
                )}
                
                {/* Image clipped to path */}
                <Group
                  x={-tabSize}
                  y={-tabSize}
                  opacity={isLockedByOther ? 0.5 : 1}
                  ref={(node) => {
                    if (node && image && !node.isCached()) {
                      // Cache the piece for performance and to isolate source-in blending
                      node.cache({
                        x: 0,
                        y: 0,
                        width: PIECE_WIDTH + tabSize * 2,
                        height: PIECE_HEIGHT + tabSize * 2,
                        pixelRatio: 2 // High quality
                      });
                    }
                  }}
                >
                  <Path
                    data={pathData}
                    fill="white"
                  />
                  {image && (
                    <KonvaImage
                      image={image}
                      x={-col * PIECE_WIDTH + tabSize}
                      y={-row * PIECE_HEIGHT + tabSize}
                      width={BOARD_WIDTH}
                      height={BOARD_HEIGHT}
                      globalCompositeOperation="source-in"
                    />
                  )}
                </Group>

                {/* Stroke */}
                <Path
                  data={pathData}
                  x={-tabSize}
                  y={-tabSize}
                  stroke={isDragging ? "#3b82f6" : "#1e293b"}
                  strokeWidth={isDragging ? 3 : 1}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
