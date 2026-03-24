"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, ZoomIn, ZoomOut, Palette, Maximize2, X, Image as ImageIcon } from 'lucide-react';
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

  const [image] = useImage(IMAGE_URL, 'anonymous');

  const getColRow = useCallback((id: number) => {
    return { col: id % GRID_COLS, row: Math.floor(id / GRID_COLS) };
  }, [GRID_COLS]);

  const getScatterPositions = useCallback((totalPieces: number) => {
    // Cell size large enough to prevent any overlapping between pieces
    const cw = PIECE_WIDTH * 1.6;
    const ch = PIECE_HEIGHT * 1.6;
    
    // Define the forbidden area (the board + padding for piece tabs)
    // A piece's top-left is at (x,y). It extends roughly -0.2*W to +1.2*W.
    // To be completely outside the board (0 to BOARD_WIDTH):
    // Left of board: x + 1.2*W < 0 => x < -1.2*W
    // Right of board: x - 0.2*W > BOARD_WIDTH => x > BOARD_WIDTH + 0.2*W
    const board_min_x = -PIECE_WIDTH * 1.3;
    const board_max_x = BOARD_WIDTH + PIECE_WIDTH * 0.3;
    const board_min_y = -PIECE_HEIGHT * 1.3;
    const board_max_y = BOARD_HEIGHT + PIECE_HEIGHT * 0.3;
    
    const centerX = BOARD_WIDTH / 2;
    const centerY = BOARD_HEIGHT / 2;
    
    const positions: {x: number, y: number}[] = [];
    const searchRadius = Math.ceil(Math.sqrt(totalPieces)) + 10;
    
    const start_c = -searchRadius;
    const end_c = Math.ceil(BOARD_WIDTH / cw) + searchRadius;
    const start_r = -searchRadius;
    const end_r = Math.ceil(BOARD_HEIGHT / ch) + searchRadius;
    
    for (let c = start_c; c <= end_c; c++) {
      for (let r = start_r; r <= end_r; r++) {
        const px = c * cw;
        const py = r * ch;
        
        const isInsideBoard = px >= board_min_x && px <= board_max_x && py >= board_min_y && py <= board_max_y;
        
        if (!isInsideBoard) {
          positions.push({ x: px, y: py });
        }
      }
    }
    
    // Sort by distance to the center of the board so pieces cluster around it
    positions.sort((a, b) => {
      const distA = Math.pow(a.x - centerX, 2) + Math.pow(a.y - centerY, 2);
      const distB = Math.pow(b.x - centerX, 2) + Math.pow(b.y - centerY, 2);
      return distA - distB;
    });
    
    // Take exactly the number of pieces we need
    const selectedPositions = positions.slice(0, totalPieces);
    
    // Shuffle the selected positions so the puzzle pieces are randomly distributed
    for (let i = selectedPositions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [selectedPositions[i], selectedPositions[j]] = [selectedPositions[j], selectedPositions[i]];
    }
    
    // Add a small jitter to make it look slightly organic, but keep it small to avoid overlaps
    return selectedPositions.map(pos => ({
      x: pos.x + (Math.random() - 0.5) * (PIECE_WIDTH * 0.1),
      y: pos.y + (Math.random() - 0.5) * (PIECE_HEIGHT * 0.1)
    }));
  }, [BOARD_WIDTH, BOARD_HEIGHT, PIECE_WIDTH, PIECE_HEIGHT]);

  const [pieces, setPieces] = useState<PuzzlePiece[]>([]);
  const [userId] = useState(() => uuidv4());
  const [isReady, setIsReady] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const [pieceImages, setPieceImages] = useState<Record<string, HTMLCanvasElement>>({});
  const [isStageDragging, setIsStageDragging] = useState(false);
  const [bgColor, setBgColor] = useState('bg-slate-900');
  const [showLargePreview, setShowLargePreview] = useState(false);
  
  const totalPieces = GRID_COLS * GRID_ROWS;
  const showBoardBackground = totalPieces <= 150;
  
  const bgColors = [
    'bg-slate-900',
    'bg-stone-900',
    'bg-indigo-950',
    'bg-emerald-950',
    'bg-slate-100',
    'bg-amber-50',
  ];
  
  const stageScale = useRef(1);
  const stagePos = useRef({ x: 0, y: 0 });
  
  const [playerCount, setPlayerCount] = useState(1);
  const [boardScore, setBoardScore] = useState(0);
  const [connectionScore, setConnectionScore] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  
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

  // Pre-crop images for performance
  useEffect(() => {
    if (!image) return;

    const generateImages = () => {
      const images: Record<string, HTMLCanvasElement> = {};
      const tabSize = Math.min(PIECE_WIDTH, PIECE_HEIGHT) * TAB_SIZE_RATIO;
      const padding = tabSize;

      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const canvas = document.createElement('canvas');
          canvas.width = PIECE_WIDTH + padding * 2;
          canvas.height = PIECE_HEIGHT + padding * 2;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          const pathString = getPiecePath(col, row, GRID_COLS, GRID_ROWS, PIECE_WIDTH, PIECE_HEIGHT);
          const path = new Path2D(pathString);

          ctx.clip(path);
          ctx.drawImage(
            image,
            -col * PIECE_WIDTH + padding,
            -row * PIECE_HEIGHT + padding,
            BOARD_WIDTH,
            BOARD_HEIGHT
          );

          // Bake a subtle inner stroke into the PNG for piece visibility
          ctx.lineWidth = 2; // 2px centered on path = 1px inner stroke due to clip
          ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
          ctx.stroke(path);

          images[`${col}-${row}`] = canvas;
        }
      }
      setPieceImages(images);
      setImagesReady(true);
    };

    generateImages();
  }, [image, GRID_COLS, GRID_ROWS, PIECE_WIDTH, PIECE_HEIGHT, BOARD_WIDTH, BOARD_HEIGHT, getPiecePath]);

  // Center the camera on mount
  useEffect(() => {
    stagePos.current = {
      x: window.innerWidth / 2 - BOARD_WIDTH / 2,
      y: window.innerHeight / 2 - BOARD_HEIGHT / 2,
    };
    if (stageRef.current) {
      stageRef.current.position(stagePos.current);
      stageRef.current.batchDraw();
    }
  }, [BOARD_WIDTH, BOARD_HEIGHT]);

  // Prevent native browser touch actions (scrolling, zooming) on the canvas
  useEffect(() => {
    if (!isReady || !containerRef.current) return;
    
    const container = containerRef.current;
    
    const preventDefault = (e: Event) => {
      if (e.cancelable) {
        e.preventDefault();
      }
    };
    
    container.addEventListener('touchmove', preventDefault, { passive: false });
    container.addEventListener('wheel', preventDefault, { passive: false });
    
    return () => {
      container.removeEventListener('touchmove', preventDefault);
      container.removeEventListener('wheel', preventDefault);
    };
  }, [isReady]);

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
        if (data.length === GRID_COLS * GRID_ROWS) {
          const processedData = data.map(p => {
            const { col, row } = getColRow(p.piece_id);
            const targetX = col * PIECE_WIDTH;
            const targetY = row * PIECE_HEIGHT;
            const is_snapped = Math.abs(p.current_x - targetX) < 1 && Math.abs(p.current_y - targetY) < 1;
            return { ...p, is_snapped };
          });
          setPieces(processedData);
        } else {
          if (data.length > 0) {
            const extraIds = data.map(p => p.piece_id);
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
      const totalPieces = GRID_COLS * GRID_ROWS;
      const scatterPositions = getScatterPositions(totalPieces);

      for (let i = 0; i < totalPieces; i++) {
        initialPieces.push({
          piece_id: i,
          current_x: scatterPositions[i].x,
          current_y: scatterPositions[i].y,
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
  }, [roomConfig.roomId, GRID_COLS, GRID_ROWS, BOARD_WIDTH, BOARD_HEIGHT, getColRow]);

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
          const stage = stageRef.current;
          if (stage) {
            const dragLayer = stage.findOne('#drag-layer');
            const idleLayer = stage.findOne('#idle-layer');
            if (dragLayer && idleLayer) {
              piece_ids.forEach((id: number) => {
                const node = stage.findOne(`#piece-${id}`);
                if (node) node.moveTo(dragLayer);
              });
              dragLayer.batchDraw();
              idleLayer.batchDraw();
            }
          }
          setPieces((prev) => prev.map(p => 
            piece_ids.includes(p.piece_id) ? { ...p, locked_by } : p
          ));
        }
      } else if (payload.event === 'piece-drop') {
        const { pieces: droppedPieces } = payload.payload;
        const stage = stageRef.current;
        if (stage) {
          const idleLayer = stage.findOne('#idle-layer');
          const dragLayer = stage.findOne('#drag-layer');
          if (idleLayer && dragLayer) {
            droppedPieces.forEach((dp: any) => {
              const node = stage.findOne(`#piece-${dp.piece_id}`);
              if (node) node.moveTo(idleLayer);
            });
            dragLayer.batchDraw();
            idleLayer.batchDraw();
          }
        }
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

    const stage = e.target.getStage();
    if (stage) {
      const dragLayer = stage.findOne('#drag-layer');
      const idleLayer = stage.findOne('#idle-layer');
      
      if (dragLayer && idleLayer) {
        groupIds.forEach(id => {
          const node = stage.findOne(`#piece-${id}`);
          if (node) {
            node.moveTo(dragLayer);
            node.moveToTop();
          }
        });
        dragLayer.batchDraw();
        idleLayer.batchDraw();
      }
    }

    setPieces((prev) => prev.map(p => 
      groupIds.includes(p.piece_id) ? { ...p, locked_by: userId } : p
    ));

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

    const stage = e.target.getStage();
    if (stage) {
      const idleLayer = stage.findOne('#idle-layer');
      const dragLayer = stage.findOne('#drag-layer');
      
      if (idleLayer && dragLayer) {
        groupIds.forEach(id => {
          const node = stage.findOne(`#piece-${id}`);
          if (node) node.moveTo(idleLayer);
        });
        dragLayer.batchDraw();
        idleLayer.batchDraw();
      }
    }

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

    const zoomSensitivity = 0.0005; // Finer step for mouse wheel
    const newScale = Math.min(Math.max(0.1, oldScale - e.evt.deltaY * zoomSensitivity), 5);

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    stage.scaleX(newScale);
    stage.scaleY(newScale);
    stage.position(newPos);
    stage.batchDraw();

    stageScale.current = newScale;
    stagePos.current = newPos;
  };

  const handleManualZoom = (direction: 1 | -1) => {
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const zoomFactor = 1.15; // Finer step for manual zoom buttons
    const newScale = direction === 1 
      ? Math.min(oldScale * zoomFactor, 5) 
      : Math.max(oldScale / zoomFactor, 0.1);

    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;

    const mousePointTo = {
      x: (centerX - stage.x()) / oldScale,
      y: (centerY - stage.y()) / oldScale,
    };

    const newPos = {
      x: centerX - mousePointTo.x * newScale,
      y: centerY - mousePointTo.y * newScale,
    };

    stage.scaleX(newScale);
    stage.scaleY(newScale);
    stage.position(newPos);
    stage.batchDraw();

    stageScale.current = newScale;
    stagePos.current = newPos;
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

  if (!isReady || !imagesReady) {
    return (
      <div className={`flex items-center justify-center h-screen ${bgColor} text-white transition-colors duration-500`}>
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const renderPiece = (piece: PuzzlePiece) => {
    const { col, row } = getColRow(piece.piece_id);
    const tabSize = Math.min(PIECE_WIDTH, PIECE_HEIGHT) * TAB_SIZE_RATIO;
    const pathData = getPiecePath(col, row, GRID_COLS, GRID_ROWS, PIECE_WIDTH, PIECE_HEIGHT);

    const isLockedByOther = piece.locked_by && piece.locked_by !== userId;
    const isDragging = piece.locked_by === userId;
    const pieceImage = pieceImages[`${col}-${row}`];
    const showShadow = !piece.is_snapped && !isStageDragging;

    return (
      <Group
        key={piece.piece_id}
        id={`piece-${piece.piece_id}`}
        x={piece.current_x}
        y={piece.current_y}
        draggable={!piece.is_snapped && !isLockedByOther}
        listening={!piece.is_snapped}
        onDragStart={(e) => {
          handleDragStart(e, piece);
        }}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        opacity={isLockedByOther ? 0.5 : 1}
      >
        {pieceImage && (
          <KonvaImage
            image={pieceImage}
            x={-tabSize}
            y={-tabSize}
            shadowColor={isDragging ? "#3b82f6" : "black"}
            shadowBlur={showShadow ? (isDragging ? 20 : 10) : 0}
            shadowOffset={{ x: 0, y: showShadow ? (isDragging ? 10 : 5) : 0 }}
            shadowOpacity={showShadow ? (isDragging ? 0.8 : 0.2) : 0}
            perfectDrawEnabled={false}
          />
        )}
      </Group>
    );
  };

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-screen ${bgColor} overflow-hidden touch-none font-sans transition-colors duration-500`}
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
              const totalPieces = GRID_COLS * GRID_ROWS;
              const scatterPositions = getScatterPositions(totalPieces);
              const resetPieces = pieces.map((p, i) => {
                return {
                  ...p,
                  current_x: scatterPositions[i].x,
                  current_y: scatterPositions[i].y,
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
        scaleX={stageScale.current}
        scaleY={stageScale.current}
        x={stagePos.current.x}
        y={stagePos.current.y}
        onWheel={handleWheel}
        draggable
        ref={stageRef}
        onDragStart={(e) => {
          if (e.target === e.currentTarget) {
            setIsStageDragging(true);
          }
        }}
        onDragMove={(e) => {
          if (e.target === e.currentTarget) {
            stagePos.current = { x: e.target.x(), y: e.target.y() };
          }
        }}
        onDragEnd={(e) => {
          if (e.target === e.currentTarget) {
            stagePos.current = { x: e.target.x(), y: e.target.y() };
            setIsStageDragging(false);
          }
        }}
      >
        <Layer id="background-layer">
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
          {image && showBoardBackground && (
            <KonvaImage
              image={image}
              x={0}
              y={0}
              width={BOARD_WIDTH}
              height={BOARD_HEIGHT}
              opacity={0.1}
            />
          )}
        </Layer>

        <Layer id="snapped-layer">
          {pieces.filter(p => p.is_snapped).map(renderPiece)}
        </Layer>

        <Layer id="idle-layer">
          {pieces.filter(p => !p.is_snapped).map(renderPiece)}
        </Layer>

        <Layer id="drag-layer" />
      </Stage>

      {/* Manual Zoom & Settings Controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-20">
        <button
          onClick={() => {
            const currentIndex = bgColors.indexOf(bgColor);
            const nextIndex = (currentIndex + 1) % bgColors.length;
            setBgColor(bgColors[nextIndex]);
          }}
          className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md p-3 rounded-full border border-slate-700 text-slate-300 shadow-lg transition-colors"
          aria-label="Change Background Color"
          title="Change Background Color"
        >
          <Palette size={24} />
        </button>
        <button
          onClick={() => handleManualZoom(1)}
          className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md p-3 rounded-full border border-slate-700 text-slate-300 shadow-lg transition-colors mt-2"
          aria-label="Zoom In"
        >
          <ZoomIn size={24} />
        </button>
        <button
          onClick={() => handleManualZoom(-1)}
          className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md p-3 rounded-full border border-slate-700 text-slate-300 shadow-lg transition-colors"
          aria-label="Zoom Out"
        >
          <ZoomOut size={24} />
        </button>
      </div>

      {/* Minimap for large puzzles */}
      {!showBoardBackground && image && (
        <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2">
          <div className="bg-slate-800/80 backdrop-blur-md p-2 rounded-xl border border-slate-700 shadow-lg pointer-events-auto">
            <div 
              className="relative group cursor-pointer" 
              onClick={() => setShowLargePreview(true)}
              title="View Original Image"
            >
              <img 
                src={roomConfig.imageUrl} 
                alt="Puzzle Preview" 
                className="w-32 h-auto rounded-lg opacity-80 group-hover:opacity-100 transition-opacity"
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-lg">
                <Maximize2 className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Large Preview Modal */}
      {showLargePreview && (
        <div 
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 pointer-events-auto" 
          onClick={() => setShowLargePreview(false)}
        >
          <div className="relative max-w-full max-h-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setShowLargePreview(false)}
              className="absolute -top-4 -right-4 bg-slate-800 hover:bg-slate-700 p-2 rounded-full text-white shadow-lg border border-slate-700 transition-colors z-10"
              aria-label="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>
            <img 
              src={roomConfig.imageUrl} 
              alt="Puzzle Large Preview" 
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border border-slate-700"
            />
          </div>
        </div>
      )}
    </div>
  );
}
