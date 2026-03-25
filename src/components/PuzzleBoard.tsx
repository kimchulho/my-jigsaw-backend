"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, ZoomIn, ZoomOut, Palette, Maximize2, X, Image as ImageIcon, Clock, Trophy, Users, Link as LinkIcon, Check, WifiOff } from 'lucide-react';
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
  maxPlayers?: number;
  password?: string;
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

  const [image, status] = useImage(IMAGE_URL, 'anonymous');

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
    
    // Sort by Chebyshev distance (normalized by board dimensions) to form a rectangular arrangement
    positions.sort((a, b) => {
      const distA = Math.max(Math.abs(a.x - centerX) / BOARD_WIDTH, Math.abs(a.y - centerY) / BOARD_HEIGHT);
      const distB = Math.max(Math.abs(b.x - centerX) / BOARD_WIDTH, Math.abs(b.y - centerY) / BOARD_HEIGHT);
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
  const [bgColor, setBgColor] = useState('bg-slate-900');
  const [showLargePreview, setShowLargePreview] = useState(false);
  const [hasFittedView, setHasFittedView] = useState(false);
  const [isIdleDisconnected, setIsIdleDisconnected] = useState(false);
  
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  
  const totalPieces = GRID_COLS * GRID_ROWS;
  const isSmallPuzzle = totalPieces <= 100;
  const [showBoardBackground, setShowBoardBackground] = useState(false);
  
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
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<{username: string, score: number}[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [isDisconnected, setIsDisconnected] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const myDragLayerRef = useRef<Konva.Layer>(null);
  const otherDragLayerRef = useRef<Konva.Layer>(null);
  
  const draggingGroupRef = useRef<number[]>([]);

  const cursorsLayerRef = useRef<Konva.Layer>(null);
  const lastCursorBroadcastRef = useRef<number>(0);
  const [userColor] = useState(() => {
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
    return colors[Math.floor(Math.random() * colors.length)];
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const cursorsLayer = cursorsLayerRef.current;
      if (!cursorsLayer) return;
      
      const now = Date.now();
      const children = cursorsLayer.getChildren();
      
      children.forEach((child) => {
        const lastUpdate = child.getAttr('lastUpdate');
        if (lastUpdate && now - lastUpdate > 3000) {
          child.destroy();
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isReady && imagesReady) {
      if (myDragLayerRef.current) {
        const canvas = myDragLayerRef.current.getCanvas()._canvas;
        canvas.style.filter = 'drop-shadow(0px 10px 20px rgba(59, 130, 246, 0.8))';
      }
      if (otherDragLayerRef.current) {
        const canvas = otherDragLayerRef.current.getCanvas()._canvas;
        canvas.style.filter = 'drop-shadow(0px 5px 10px rgba(0, 0, 0, 0.2))';
      }
    }
  }, [isReady, imagesReady]);
  const lastBroadcastRef = useRef<number>(0);
  const piecesRef = useRef<PuzzlePiece[]>([]);
  const activeTweensRef = useRef<Record<string, Konva.Tween>>({});

  useEffect(() => {
    const handleDisconnect = () => setIsDisconnected(true);
    const handleConnect = () => setIsDisconnected(false);

    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);

    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
    };
  }, []);

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

  // Idle timeout logic
  const handleIdleTimeout = useCallback(() => {
    if (socket.connected) {
      socket.disconnect();
      setIsIdleDisconnected(true);
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    if (!isIdleDisconnected) {
      idleTimeoutRef.current = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
    }
  }, [handleIdleTimeout, isIdleDisconnected, IDLE_TIMEOUT_MS]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'wheel'];
    const handleActivity = () => resetIdleTimer();

    events.forEach(event => window.addEventListener(event, handleActivity));
    resetIdleTimer(); // Initial start

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, [resetIdleTimer]);

  const handleReconnect = () => {
    setIsIdleDisconnected(false);
    socket.connect();
    socket.emit('join_room', { roomId: roomConfig.roomId, password: roomConfig.password }, (res: any) => {
      if (res && !res.success) {
        alert(res.message || 'Failed to reconnect to room');
        if (onBack) onBack();
      }
    });
    socket.emit('get_pieces', roomConfig.roomId);
    resetIdleTimer();
  };

  const updateCursorsScale = useCallback((scale: number) => {
    const layer = cursorsLayerRef.current;
    if (!layer) return;
    const invScale = 1 / scale;
    layer.getChildren().forEach(child => {
      child.scale({ x: invScale, y: invScale });
    });
    layer.batchDraw();
  }, []);

  const fitViewToPieces = useCallback((piecesToFit: PuzzlePiece[]) => {
    if (!stageRef.current || piecesToFit.length === 0 || dimensions.width === 0) return false;

    let minX = 0;
    let minY = 0;
    let maxX = BOARD_WIDTH;
    let maxY = BOARD_HEIGHT;

    piecesToFit.forEach(p => {
      if (p.current_x < minX) minX = p.current_x;
      if (p.current_y < minY) minY = p.current_y;
      if (p.current_x + PIECE_WIDTH > maxX) maxX = p.current_x + PIECE_WIDTH;
      if (p.current_y + PIECE_HEIGHT > maxY) maxY = p.current_y + PIECE_HEIGHT;
    });

    // Add padding around the edges
    const padding = 100;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const scaleX = dimensions.width / contentWidth;
    const scaleY = dimensions.height / contentHeight;
    const newScale = Math.min(scaleX, scaleY, 1); // Cap max zoom at 1 so it doesn't zoom in too much

    const newPos = {
      x: (dimensions.width - contentWidth * newScale) / 2 - minX * newScale,
      y: (dimensions.height - contentHeight * newScale) / 2 - minY * newScale
    };

    const stage = stageRef.current;
    stage.scaleX(newScale);
    stage.scaleY(newScale);
    stage.position(newPos);
    stage.batchDraw();

    stageScale.current = newScale;
    stagePos.current = newPos;
    updateCursorsScale(newScale);
    return true;
  }, [dimensions.width, dimensions.height, PIECE_WIDTH, PIECE_HEIGHT, BOARD_WIDTH, BOARD_HEIGHT, updateCursorsScale]);

  useEffect(() => {
    if (pieces.length > 0 && !hasFittedView && dimensions.width > 0) {
      // Small delay to ensure Konva stage is fully rendered
      setTimeout(() => {
        const success = fitViewToPieces(pieces);
        if (success) setHasFittedView(true);
      }, 100);
    }
  }, [pieces, hasFittedView, dimensions.width, fitViewToPieces]);

  // Initialize pieces from DB
  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    socket.emit('join_room', { roomId: roomConfig.roomId, password: roomConfig.password }, (res: any) => {
      if (res && !res.success) {
        alert(res.message || 'Failed to join room');
        if (onBack) onBack();
      }
    });

    const handlePiecesState = (data: any[]) => {
      if (data && data.length > 0) {
        if (data.length === GRID_COLS * GRID_ROWS) {
          setPieces(prevPieces => {
            const processedData = data.map(p => {
              const { col, row } = getColRow(p.piece_id);
              const targetX = col * PIECE_WIDTH;
              const targetY = row * PIECE_HEIGHT;
              const is_snapped = Math.abs(p.current_x - targetX) < 1 && Math.abs(p.current_y - targetY) < 1;
              
              // Prevent rubber-banding: preserve real-time positions of locked pieces
              const existingPiece = prevPieces.find(prev => prev.piece_id === p.piece_id);
              if (existingPiece && existingPiece.locked_by) {
                return { 
                  ...p, 
                  is_snapped,
                  current_x: existingPiece.current_x, 
                  current_y: existingPiece.current_y,
                  locked_by: existingPiece.locked_by 
                };
              }
              
              return { ...p, is_snapped };
            });
            return processedData;
          });
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

    const handleRoomState = (room: any) => {
      if (room.playTime !== undefined) {
        setPlayTime(room.playTime);
      }
    };

    socket.on('room_state', handleRoomState);
    socket.on('pieces_state', handlePiecesState);
    socket.emit('get_pieces', roomConfig.roomId);

    const handleScoreState = (data: { score: number }) => {
      setScore(data.score || 0);
    };
    
    const handleAllScores = (scores: {username: string, score: number}[]) => {
      const validScores = scores.map(s => ({ ...s, score: s.score || 0 }));
      const sorted = validScores.sort((a, b) => b.score - a.score);
      setLeaderboard(sorted);
    };

    socket.on('score_state', handleScoreState);
    socket.on('all_scores', handleAllScores);
    socket.emit('get_score', { roomId: roomConfig.roomId, username });
    socket.emit('get_all_scores', roomConfig.roomId);

    return () => {
      socket.off('room_state', handleRoomState);
      socket.off('pieces_state', handlePiecesState);
      socket.off('score_state', handleScoreState);
      socket.off('all_scores', handleAllScores);
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
          
          // 2 & 3: Interpolation and Direct Canvas Manipulation
          const stage = stageRef.current;
          if (stage) {
            // Cancel existing tween for this user
            if (activeTweensRef.current[locked_by]) {
              activeTweensRef.current[locked_by].destroy();
              delete activeTweensRef.current[locked_by];
            }

            const animData = updatedPieces.map((up: any) => {
              const node = stage.findOne(`#piece-${up.piece_id}`);
              return {
                node,
                piece_id: up.piece_id,
                startX: node ? node.x() : up.current_x,
                startY: node ? node.y() : up.current_y,
                endX: up.current_x,
                endY: up.current_y,
              };
            });

            const leader = animData.find(data => data.node);
            if (leader && leader.node) {
              const tween = new Konva.Tween({
                node: leader.node,
                duration: 0.1,
                x: leader.endX,
                y: leader.endY,
                easing: Konva.Easings.Linear,
                onUpdate: () => {
                  const currentX = leader.node.x();
                  const currentY = leader.node.y();
                  const deltaX = currentX - leader.startX;
                  const deltaY = currentY - leader.startY;
                  
                  // Apply EXACT SAME delta to all other pieces in the group
                  for (let i = 0; i < animData.length; i++) {
                    const data = animData[i];
                    if (data !== leader && data.node) {
                      data.node.x(data.startX + deltaX);
                      data.node.y(data.startY + deltaY);
                    }
                  }
                },
                onFinish: () => {
                  delete activeTweensRef.current[locked_by];
                }
              });
              activeTweensRef.current[locked_by] = tween;
              tween.play();
            }

            // Silently update the ref so future React renders don't snap it back
            updatedPieces.forEach((up: any) => {
              const piece = piecesRef.current.find(p => p.piece_id === up.piece_id);
              if (piece) {
                piece.current_x = up.current_x;
                piece.current_y = up.current_y;
              }
            });
          }
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
            const otherDragLayer = stage.findOne('#other-drag-layer') as any;
            const idleLayer = stage.findOne('#idle-layer') as any;
            if (otherDragLayer && idleLayer) {
              piece_ids.forEach((id: number) => {
                const node = stage.findOne(`#piece-${id}`);
                if (node) node.moveTo(otherDragLayer);
              });
              otherDragLayer.batchDraw();
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
          const idleLayer = stage.findOne('#idle-layer') as any;
          const otherDragLayer = stage.findOne('#other-drag-layer') as any;
          if (idleLayer && otherDragLayer) {
            droppedPieces.forEach((dp: any) => {
              const node = stage.findOne(`#piece-${dp.piece_id}`);
              if (node) node.moveTo(idleLayer);
            });
            otherDragLayer.batchDraw();
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
      } else if (payload.event === 'mouse-move') {
        const { x, y, userId: senderId, name, color } = payload.payload;
        if (senderId === userId) return;

        const cursorsLayer = cursorsLayerRef.current;
        if (!cursorsLayer) return;

        let cursorGroup = cursorsLayer.findOne(`#cursor-${senderId}`) as Konva.Group;
        if (!cursorGroup) {
          const invScale = 1 / stageScale.current;
          cursorGroup = new Konva.Group({
            id: `cursor-${senderId}`,
            x,
            y,
            scaleX: invScale,
            scaleY: invScale,
          });

          const path = new Konva.Path({
            data: 'M5.5 22.5L2.5 2.5L22.5 9.5L13.5 13.5L5.5 22.5Z',
            fill: color,
            stroke: 'white',
            strokeWidth: 2,
            shadowColor: 'black',
            shadowBlur: 4,
            shadowOpacity: 0.3,
            shadowOffset: { x: 2, y: 2 },
          });

          const label = new Konva.Label({
            x: 15,
            y: 15,
          });

          label.add(new Konva.Tag({
            fill: color,
            cornerRadius: 4,
          }));

          label.add(new Konva.Text({
            text: name,
            padding: 4,
            fill: 'white',
            fontSize: 12,
            fontFamily: 'sans-serif',
            fontStyle: 'bold',
          }));

          cursorGroup.add(path);
          cursorGroup.add(label);
          cursorsLayer.add(cursorGroup);
        }

        cursorGroup.to({
          x,
          y,
          duration: 0.1,
          easing: Konva.Easings.Linear,
        });
        
        cursorGroup.setAttr('lastUpdate', Date.now());
      }
    };

    socket.on('broadcast', handleBroadcast);
    socket.on('player_count', setPlayerCount);
    socket.on('play_time_update', setPlayTime);

    socket.emit('broadcast', {
      roomId: roomConfig.roomId,
      event: 'request-sync',
      payload: { from: userId }
    });

    return () => {
      socket.off('broadcast', handleBroadcast);
      socket.off('player_count', setPlayerCount);
      socket.off('play_time_update', setPlayTime);
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
      const myDragLayer = stage.findOne('#my-drag-layer') as any;
      const idleLayer = stage.findOne('#idle-layer') as any;
      
      if (myDragLayer && idleLayer) {
        groupIds.forEach(id => {
          const node = stage.findOne(`#piece-${id}`);
          if (node) {
            node.moveTo(myDragLayer);
            node.moveToTop();
          }
        });
        myDragLayer.batchDraw();
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

  const broadcastCursorPosition = useCallback((stage: Konva.Stage | null) => {
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const relativePos = {
      x: (pos.x - stage.x()) / stage.scaleX(),
      y: (pos.y - stage.y()) / stage.scaleY()
    };

    const now = Date.now();
    if (now - lastCursorBroadcastRef.current > 100) {
      socket.emit('broadcast', {
        roomId: roomConfig.roomId,
        event: 'mouse-move',
        payload: { x: relativePos.x, y: relativePos.y, userId, name: username || 'Guest', color: userColor },
      });
      lastCursorBroadcastRef.current = now;
    }
  }, [roomConfig.roomId, userId, username, userColor]);

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
    if (now - lastBroadcastRef.current > 100) {
      socket.emit('broadcast', {
        roomId: roomConfig.roomId,
        event: 'cursor-pos',
        payload: { pieces: updatedPieces, locked_by: userId },
      });
      lastBroadcastRef.current = now;
    }

    broadcastCursorPosition(e.target.getStage());
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const groupIds = draggingGroupRef.current;
    if (groupIds.length === 0) return;

    const stage = e.target.getStage();
    if (stage) {
      const idleLayer = stage.findOne('#idle-layer') as any;
      const myDragLayer = stage.findOne('#my-drag-layer') as any;
      
      if (idleLayer && myDragLayer) {
        groupIds.forEach(id => {
          const node = stage.findOne(`#piece-${id}`);
          if (node) node.moveTo(idleLayer);
        });
        myDragLayer.batchDraw();
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
    let newScore = score;

    for (const p of piecesRef.current) {
      if (groupIds.includes(p.piece_id)) {
        const finalX = p.current_x + deltaX + dx;
        const finalY = p.current_y + deltaY + dy;
        
        finalPieces.push({ 
          piece_id: p.piece_id, 
          current_x: finalX, 
          current_y: finalY, 
          locked_by: null, 
          is_snapped: p.is_snapped || isSnapped 
        });
      }
    }
    
    if (isSnapped || snappedToAdjacent) {
      newScore += 1;
    }

    if (newScore !== score) {
      setScore(newScore);
      socket.emit('update_score', { 
        roomId: roomConfig.roomId, 
        username, 
        score: newScore 
      });
    }

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
    updateCursorsScale(newScale);
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
    updateCursorsScale(newScale);
  };

  const completedCount = pieces.filter(p => p.is_snapped).length;
  const isCompleted = completedCount === GRID_COLS * GRID_ROWS && completedCount > 0;

  useEffect(() => {
    if (isCompleted) {
      socket.emit('puzzle_completed', roomConfig.roomId);
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

  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white">
        <p className="text-xl mb-4 text-red-400">이미지를 불러오는데 실패했습니다.</p>
        <p className="text-slate-400 mb-8">이미지 서버에서 접근을 차단했거나 삭제된 이미지입니다.</p>
        <button onClick={onBack} className="px-6 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors">
          돌아가기
        </button>
      </div>
    );
  }

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
            perfectDrawEnabled={false}
          />
        )}
      </Group>
    );
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomConfig.roomId);
    if (roomConfig.password) {
      url.searchParams.set('pwd', roomConfig.password);
    }
    navigator.clipboard.writeText(url.toString());
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
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
          <button 
            onClick={handleCopyLink}
            className="flex items-center gap-2 bg-indigo-600/80 hover:bg-indigo-500 backdrop-blur-md px-4 py-2 rounded-full border border-indigo-500/50 text-white text-sm transition-colors"
          >
            {copiedLink ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
            {copiedLink ? 'Copied!' : 'Invite Link'}
          </button>
          {onBack && (
            <button 
              onClick={onBack}
              className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 text-slate-300 text-sm transition-colors"
            >
              Back
            </button>
          )}
          <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700">
            <span className="text-white font-medium">{completedCount} / {GRID_COLS * GRID_ROWS}</span>
            <span className="text-slate-400 ml-2 text-sm">Pieces Placed</span>
          </div>
          <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span className="text-white font-medium font-mono">{formatTime(playTime)}</span>
          </div>
          <button
            onClick={() => setShowLeaderboard(true)}
            className="bg-slate-800/80 hover:bg-slate-700 transition-colors backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 flex items-center gap-2 cursor-pointer"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-white font-medium text-sm">{playerCount} Player{playerCount !== 1 ? 's' : ''}</span>
          </button>
        </div>
      </div>

      {showLeaderboard && (
        <div className="absolute top-20 right-4 z-50 bg-slate-800/90 backdrop-blur-xl rounded-xl border border-slate-700 p-3 w-56 shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white text-sm font-bold flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-yellow-400" />
              Leaderboard
            </h3>
            <button onClick={() => setShowLeaderboard(false)} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {(() => {
              const displayLeaderboard = [...leaderboard];
              if (!displayLeaderboard.find(p => p.username === username)) {
                displayLeaderboard.push({ username, score: score || 0 });
                displayLeaderboard.sort((a, b) => b.score - a.score);
              }
              return displayLeaderboard.map((player, idx) => {
                return (
                  <div key={player.username} className={`flex items-center justify-between p-1.5 rounded-md ${player.username === username ? 'bg-indigo-500/20 border border-indigo-500/30' : 'bg-slate-700/30'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-xs w-4 text-center ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {idx + 1}
                      </span>
                      <div className={`flex items-baseline max-w-[100px] ${player.username === username ? 'text-indigo-300 font-semibold' : 'text-slate-200'}`}>
                        <span className="truncate text-sm">
                          {player.username.split('#')[0]}
                        </span>
                        {player.username.includes('#') && (
                          <span className="text-[10px] opacity-50 ml-0.5 shrink-0">#{player.username.split('#')[1]}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end leading-tight">
                      <span className="text-white text-sm font-bold">{player.score}</span>
                    </div>
                  </div>
                );
              });
            })()}
            {leaderboard.length === 0 && score === 0 && (
              <div className="text-slate-500 text-xs text-center py-2">No scores yet</div>
            )}
          </div>
        </div>
      )}

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
        onMouseMove={(e) => broadcastCursorPosition(e.target.getStage())}
        draggable
        ref={stageRef}
        onDragMove={(e) => {
          if (e.target === e.currentTarget) {
            stagePos.current = { x: e.target.x(), y: e.target.y() };
            broadcastCursorPosition(e.target.getStage());
          }
        }}
        onDragEnd={(e) => {
          if (e.target === e.currentTarget) {
            stagePos.current = { x: e.target.x(), y: e.target.y() };
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
            stroke="#818cf8"
            strokeWidth={4}
            dash={[15, 10]}
            fill="rgba(15, 23, 42, 0.3)"
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

        <Layer id="other-drag-layer" ref={otherDragLayerRef} />
        <Layer id="my-drag-layer" ref={myDragLayerRef} />
        <Layer id="cursors-layer" ref={cursorsLayerRef} />
      </Stage>

      {/* Manual Zoom & Settings Controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-20">
        {isSmallPuzzle && (
          <button
            onClick={() => setShowBoardBackground(!showBoardBackground)}
            className={`backdrop-blur-md p-3 rounded-full border shadow-lg transition-colors ${showBoardBackground ? 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white' : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'}`}
            aria-label="Toggle Background Guide"
            title="Toggle Background Guide"
          >
            <ImageIcon size={24} />
          </button>
        )}
        <button
          onClick={() => {
            const currentIndex = bgColors.indexOf(bgColor);
            const nextIndex = (currentIndex + 1) % bgColors.length;
            setBgColor(bgColors[nextIndex]);
          }}
          className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md p-3 rounded-full border border-slate-700 text-slate-300 shadow-lg transition-colors mt-2"
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

      {/* Minimap for all puzzles */}
      {image && (
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

      {/* Idle Disconnect Modal */}
      {isIdleDisconnected && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 pointer-events-auto">
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full text-center flex flex-col items-center animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center mb-4">
              <Clock className="w-8 h-8 text-slate-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Are you still there?</h2>
            <p className="text-slate-300 mb-8">
              You have been disconnected from the server due to 5 minutes of inactivity.
            </p>
            <div className="flex gap-4 w-full">
              <button
                onClick={onBack}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-medium transition-colors"
              >
                Return to Lobby
              </button>
              <button
                onClick={handleReconnect}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-medium transition-colors"
              >
                Reconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnected Modal */}
      {isDisconnected && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 pointer-events-auto">
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full text-center flex flex-col items-center animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mb-4">
              <WifiOff className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Connection Lost</h2>
            <p className="text-slate-300 mb-8">
              The connection to the server has been lost. Please return to the lobby to reconnect.
            </p>
            <button
              onClick={onBack}
              className="w-full bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl font-medium transition-colors"
            >
              Return to Lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
