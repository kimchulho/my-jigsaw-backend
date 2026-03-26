"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from '../lib/socket';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, ZoomIn, ZoomOut, Palette, Maximize, Minimize, Maximize2, X, Image as ImageIcon, Clock, Trophy, Users, Link as LinkIcon, Check, WifiOff, Bot } from 'lucide-react';
import { getPiecePath, TAB_SIZE_RATIO } from '../utils/puzzleShapes';
import confetti from 'canvas-confetti';
import { Stage, Layer, Group, Path, Image as KonvaImage, Rect } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';

const PlayTimeDisplay = () => {
  const [playTime, setPlayTime] = useState(0);

  useEffect(() => {
    const handleRoomState = (room: any) => {
      if (room.playTime !== undefined) {
        setPlayTime(room.playTime);
      }
    };
    
    socket.on('room_state', handleRoomState);
    socket.on('play_time_update', setPlayTime);

    return () => {
      socket.off('room_state', handleRoomState);
      socket.off('play_time_update', setPlayTime);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return <span className="text-white font-medium font-mono">{formatTime(playTime)}</span>;
};

const CachedGroup = ({ piece, isSelected, children, ...props }: any) => {
  const groupRef = useRef<Konva.Group>(null);
  useEffect(() => {
    if (groupRef.current && !piece.is_snapped) {
      // Clear cache first to force redraw before caching again
      groupRef.current.clearCache();
      
      // Add padding to cache to prevent shadow clipping
      const tabSize = Math.min(100, 100) * 0.2; // Approximate tab size
      const padding = 20; // Enough for shadowBlur=10
      
      groupRef.current.cache({
        x: -tabSize - padding,
        y: -tabSize - padding,
        width: 100 + tabSize * 2 + padding * 2,
        height: 100 + tabSize * 2 + padding * 2,
      });
    } else if (groupRef.current) {
      groupRef.current.clearCache();
    }
  }, [piece.is_snapped, isSelected]);
  return <Group ref={groupRef} {...props}>{children}</Group>;
};

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

  const piecesRef = useRef<PuzzlePiece[]>([]);
  const [userId] = useState(() => uuidv4());
  const [isReady, setIsReady] = useState(false);
  const [selectedPieceId, setSelectedPieceId] = useState<number | null>(null);
  const [imagesReady, setImagesReady] = useState(false);
  const [pieceImages, setPieceImages] = useState<Record<string, HTMLCanvasElement>>({});
  const pieceColorsRef = useRef<Record<number, string>>({});
  const [bgColor, setBgColor] = useState('bg-slate-900');
  const [showLargePreview, setShowLargePreview] = useState(false);
  const [hasFittedView, setHasFittedView] = useState(false);
  const [isIdleDisconnected, setIsIdleDisconnected] = useState(false);
  
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [botMode, setBotMode] = useState<'EDGE' | 'COLOR'>('EDGE');
  const [botSpeed, setBotSpeed] = useState(5);
  const botSpeedRef = useRef(5);
  useEffect(() => {
    botSpeedRef.current = botSpeed;
  }, [botSpeed]);
  const botRef = useRef({
    active: false,
    id: 'bot-' + Math.random().toString(36).substr(2, 9),
    name: 'Bot',
    color: '#ff00ff',
    x: -100,
    y: -100,
    state: 'IDLE',
    targetPieceId: null as number | null,
    targetX: 0,
    targetY: 0,
    startX: 0,
    startY: 0,
    controlX: 0,
    controlY: 0,
    moveStartTime: 0,
    moveDuration: 0,
    lastUpdate: 0,
    lastMoveEmit: 0,
    lastMouseEmit: 0
  });

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
  const isTouchRef = useRef(false);
  const stickyDragRef = useRef<{ pieceId: number, offsetX: number, offsetY: number } | null>(null);
  
  const [playerCount, setPlayerCount] = useState(1);
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<{username: string, score: number}[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const myDragLayerRef = useRef<Konva.Layer>(null);
  const otherDragLayerRef = useRef<Konva.Layer>(null);
  
  const draggingGroupRef = useRef<number[]>([]);
  const minimapDragRef = useRef<{ startX: number, startY: number, lastX: number, lastY: number, isDragging: boolean } | null>(null);
  const cursorsLayerRef = useRef<Konva.Layer>(null);
  const lastCursorBroadcastRef = useRef<number>(0);
  const [userColor] = useState(() => {
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
    return colors[Math.floor(Math.random() * colors.length)];
  });

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const cursorsLayer = cursorsLayerRef.current;
      if (!cursorsLayer) return;
      
      const now = Date.now();
      const children = cursorsLayer.getChildren();
      
      children.forEach((child) => {
        const lastUpdate = (child as any).getAttr('lastUpdate');
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

  // Pre-crop images for performance
  useEffect(() => {
    if (!image) return;

    const generateImages = () => {
      const images: Record<string, HTMLCanvasElement> = {};
      const tabSize = Math.min(PIECE_WIDTH, PIECE_HEIGHT) * TAB_SIZE_RATIO;
      const padding = tabSize;

      const pieceRGBs: { pieceId: number, rgb: number[] }[] = [];

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

          // Calculate average color for the bot
          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let r = 0, g = 0, b = 0, count = 0;
            // Sample every 4th pixel for performance
            for (let i = 0; i < data.length; i += 16) {
              if (data[i + 3] > 128) { // if not transparent
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                count++;
              }
            }
            if (count > 0) {
              r = Math.floor(r / count);
              g = Math.floor(g / count);
              b = Math.floor(b / count);
              
              const pieceId = row * GRID_COLS + col;
              pieceRGBs.push({ pieceId, rgb: [r, g, b] });
            }
          } catch (e) {
            // Ignore cross-origin errors if any
          }

          images[`${col}-${row}`] = canvas;
        }
      }

      // K-means clustering to find 9 dominant colors
      const k = Math.min(9, pieceRGBs.length);
      if (k > 0) {
        const data = pieceRGBs.map(p => p.rgb);
        const centroids: number[][] = [];
        const indices = new Set<number>();
        while (centroids.length < k) {
          const idx = Math.floor(Math.random() * data.length);
          if (!indices.has(idx)) {
            indices.add(idx);
            centroids.push([...data[idx]]);
          }
        }

        const assignments = new Array(data.length).fill(0);
        for (let iter = 0; iter < 20; iter++) {
          let changed = false;
          for (let i = 0; i < data.length; i++) {
            let minDist = Infinity;
            let bestCluster = 0;
            for (let c = 0; c < centroids.length; c++) {
              const dist = Math.pow(data[i][0] - centroids[c][0], 2) + 
                           Math.pow(data[i][1] - centroids[c][1], 2) + 
                           Math.pow(data[i][2] - centroids[c][2], 2);
              if (dist < minDist) {
                minDist = dist;
                bestCluster = c;
              }
            }
            if (assignments[i] !== bestCluster) {
              assignments[i] = bestCluster;
              changed = true;
            }
          }
          if (!changed) break;

          const sums = Array(k).fill(0).map(() => [0, 0, 0]);
          const counts = Array(k).fill(0);
          for (let i = 0; i < data.length; i++) {
            const cluster = assignments[i];
            counts[cluster]++;
            sums[cluster][0] += data[i][0];
            sums[cluster][1] += data[i][1];
            sums[cluster][2] += data[i][2];
          }
          for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
              centroids[c][0] = sums[c][0] / counts[c];
              centroids[c][1] = sums[c][1] / counts[c];
              centroids[c][2] = sums[c][2] / counts[c];
            }
          }
        }

        for (let i = 0; i < pieceRGBs.length; i++) {
          pieceColorsRef.current[pieceRGBs[i].pieceId] = assignments[i].toString();
        }
      }

      setPieceImages(images);
      setImagesReady(true);
    };

    generateImages();

    // Cleanup function to free canvas memory
    return () => {
      Object.values(pieceImages).forEach(canvas => {
        canvas.width = 0;
        canvas.height = 0;
      });
      setPieceImages({});
      setImagesReady(false);
    };
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
    if (isReady && imagesReady && piecesRef.current.length > 0 && !hasFittedView && dimensions.width > 0) {
      // Small delay to ensure Konva stage is fully rendered
      setTimeout(() => {
        const success = fitViewToPieces(piecesRef.current);
        if (success) setHasFittedView(true);
      }, 100);
    }
  }, [hasFittedView, dimensions.width, fitViewToPieces, isReady, imagesReady]);

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
          const processedData = data.map(p => {
            const { col, row } = getColRow(p.piece_id);
            const targetX = col * PIECE_WIDTH;
            const targetY = row * PIECE_HEIGHT;
            const is_snapped = Math.abs(p.current_x - targetX) < 1 && Math.abs(p.current_y - targetY) < 1;
            
            const existingPiece = piecesRef.current.find(prev => prev.piece_id === p.piece_id);
            
            const node = stageRef.current?.findOne(`#piece-${p.piece_id}`);
            if (node) {
              node.position({
                x: existingPiece && existingPiece.locked_by ? existingPiece.current_x : p.current_x,
                y: existingPiece && existingPiece.locked_by ? existingPiece.current_y : p.current_y
              });
            }

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
          piecesRef.current = processedData;
          stageRef.current?.batchDraw();
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
      piecesRef.current = initialPieces;
    };

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
      socket.off('pieces_state', handlePiecesState);
      socket.off('score_state', handleScoreState);
      socket.off('all_scores', handleAllScores);
    };
  }, [roomConfig.roomId, GRID_COLS, GRID_ROWS, BOARD_WIDTH, BOARD_HEIGHT, getColRow]);

  // Realtime subscription
  useEffect(() => {
    const handleBroadcast = (payload: any) => {
      // Ignore events generated by our own local bot to prevent stuttering
      if (botRef.current.active && payload.payload) {
        const botId = botRef.current.id;
        const p = payload.payload;
        if (p.userId === botId || p.locked_by === botId || p.snapped_by === botId) {
          return;
        }
      }

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
          piecesRef.current = piecesRef.current.map(p => 
            piece_ids.includes(p.piece_id) ? { ...p, locked_by } : p
          );
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
              if (node) {
                node.moveTo(idleLayer);
                node.position({ x: dp.current_x, y: dp.current_y });
              }
            });
            otherDragLayer.batchDraw();
            idleLayer.batchDraw();
          }
        }
        for (const dp of droppedPieces) {
          const piece = piecesRef.current.find(p => p.piece_id === dp.piece_id);
          if (piece) {
            Object.assign(piece, { current_x: dp.current_x, current_y: dp.current_y, locked_by: dp.locked_by, is_snapped: dp.is_snapped });
          }
        }
      } else if (payload.event === 'board-reset') {
        piecesRef.current = payload.payload.pieces;
        const stage = stageRef.current;
        if (stage) {
          payload.payload.pieces.forEach((p: PuzzlePiece) => {
            const node = stage.findOne(`#piece-${p.piece_id}`);
            if (node) {
              node.position({ x: p.current_x, y: p.current_y });
            }
          });
          stage.batchDraw();
        }
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
          piecesRef.current = processed;
          stageRef.current?.batchDraw();
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

  useEffect(() => {
    let animationFrameId: number;

    const getColorZone = (pieceId: number) => {
      const colorGroup = pieceColorsRef.current[pieceId] || '0';
      const zoneW = BOARD_WIDTH / 1.5;
      const zoneH = BOARD_HEIGHT / 1.5;
      const margin = 150;
      const colorZones: Record<string, { x: number, y: number, w: number, h: number }> = {
        '0': { x: -zoneW - margin, y: -zoneH - margin, w: zoneW, h: zoneH },
        '1': { x: BOARD_WIDTH / 2 - zoneW / 2, y: -zoneH - margin, w: zoneW, h: zoneH },
        '2': { x: BOARD_WIDTH + margin, y: -zoneH - margin, w: zoneW, h: zoneH },
        '3': { x: BOARD_WIDTH + margin, y: BOARD_HEIGHT / 2 - zoneH / 2, w: zoneW, h: zoneH },
        '4': { x: BOARD_WIDTH + margin, y: BOARD_HEIGHT + margin, w: zoneW, h: zoneH },
        '5': { x: BOARD_WIDTH / 2 - zoneW / 2, y: BOARD_HEIGHT + margin, w: zoneW, h: zoneH },
        '6': { x: -zoneW - margin, y: BOARD_HEIGHT + margin, w: zoneW, h: zoneH },
        '7': { x: -zoneW - margin, y: BOARD_HEIGHT / 2 - zoneH / 2, w: zoneW, h: zoneH },
        '8': { x: BOARD_WIDTH / 2 - zoneW / 2, y: BOARD_HEIGHT + margin + zoneH + 50, w: zoneW, h: zoneH },
      };
      return colorZones[colorGroup] || colorZones['0'];
    };

    const botTick = () => {
      const bot = botRef.current;
      if (!bot.active) return;

      const now = Date.now();
      const dt = now - bot.lastUpdate;
      bot.lastUpdate = now;

      const stage = stageRef.current;
      if (!stage) {
        animationFrameId = requestAnimationFrame(botTick);
        return;
      }

      const isPieceGrouped = (piece: PuzzlePiece) => {
        const { col: pCol, row: pRow } = getColRow(piece.piece_id);
        for (const other of piecesRef.current) {
          if (other.piece_id === piece.piece_id) continue;
          const { col: oCol, row: oRow } = getColRow(other.piece_id);
          const isAdjacent = Math.abs(pCol - oCol) + Math.abs(pRow - oRow) === 1;
          if (isAdjacent) {
            const expected_dx = (oCol - pCol) * PIECE_WIDTH;
            const expected_dy = (oRow - pRow) * PIECE_HEIGHT;
            const actual_dx = other.current_x - piece.current_x;
            const actual_dy = other.current_y - piece.current_y;
            if (Math.abs(expected_dx - actual_dx) < 1 && Math.abs(expected_dy - actual_dy) < 1) {
              return true;
            }
          }
        }
        return false;
      };

      const setupBotMove = (targetX: number, targetY: number, state: string) => {
        bot.targetX = targetX;
        bot.targetY = targetY;
        bot.state = state;
        bot.startX = bot.x;
        bot.startY = bot.y;
        bot.moveStartTime = now;
        
        const dx = targetX - bot.x;
        const dy = targetY - bot.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Human-like duration: base time + time per pixel
        const speedMultiplier = state === 'DRAGGING_PIECE' ? 1.5 : 1.0;
        const speedFactor = Math.pow(0.7, botSpeedRef.current - 5);
        bot.moveDuration = (400 + dist * speedMultiplier) * speedFactor;
        
        const midX = (bot.x + targetX) / 2;
        const midY = (bot.y + targetY) / 2;
        const nx = -dy / dist;
        const ny = dx / dist;
        // Random wobble between -0.2 and 0.2 of distance
        const wobble = (Math.random() - 0.5) * 0.4 * dist;
        bot.controlX = midX + nx * wobble;
        bot.controlY = midY + ny * wobble;
      };

      if (bot.state === 'IDLE') {
        // Find pieces based on botMode
        const targetPieces = piecesRef.current.filter(p => {
          if (p.is_snapped || p.locked_by) return false;
          if (isPieceGrouped(p)) return false;
          
          if (botMode === 'EDGE') {
            const { col, row } = getColRow(p.piece_id);
            const isEdge = col === 0 || col === GRID_COLS - 1 || row === 0 || row === GRID_ROWS - 1;
            if (!isEdge) return false;
            
            // Check if inside board
            const isInside = p.current_x >= 0 && p.current_x <= BOARD_WIDTH - PIECE_WIDTH && 
                             p.current_y >= 0 && p.current_y <= BOARD_HEIGHT - PIECE_HEIGHT;
            
            return !isInside;
          } else {
            // COLOR mode
            const zone = getColorZone(p.piece_id);
            
            const isInZone = p.current_x >= zone.x && p.current_x <= zone.x + zone.w &&
                             p.current_y >= zone.y && p.current_y <= zone.y + zone.h;
            
            if (isInZone) {
              // Check if overlapping with another piece
              const isOverlapping = piecesRef.current.some(other => {
                if (other.piece_id === p.piece_id) return false;
                const dx = p.current_x - other.current_x;
                const dy = p.current_y - other.current_y;
                return dx * dx + dy * dy < (PIECE_WIDTH * 1.6) * (PIECE_WIDTH * 1.6);
              });
              return isOverlapping;
            }
            return true;
          }
        });

        if (targetPieces.length > 0) {
          // Initial position if just started
          if (bot.x === -100) {
            bot.x = BOARD_WIDTH / 2;
            bot.y = BOARD_HEIGHT / 2;
          }

          // Pick a random piece to "look" at while searching
          const randomPiece = targetPieces[Math.floor(Math.random() * targetPieces.length)];
          
          // Set up a slow drift towards the general area of the pieces
          const driftX = randomPiece.current_x + PIECE_WIDTH / 2 + (Math.random() - 0.5) * 300;
          const driftY = randomPiece.current_y + PIECE_HEIGHT / 2 + (Math.random() - 0.5) * 300;
          
          setupBotMove(driftX, driftY, 'SEARCHING');
          
          // Override duration to simulate search time (1.5s to 3.5s)
          const speedFactor = Math.pow(0.7, botSpeedRef.current - 5);
          bot.moveDuration = (1500 + Math.random() * 2000) * speedFactor;
        } else {
          // No more pieces to move
          bot.active = false;
          setIsBotRunning(false);
          
          // Hide cursor
          const cursorsLayer = cursorsLayerRef.current;
          if (cursorsLayer) {
            const cursorGroup = cursorsLayer.findOne(`#cursor-${bot.id}`);
            if (cursorGroup) {
              cursorGroup.destroy();
              cursorsLayer.batchDraw();
            }
          }
          return;
        }
      } else if (bot.state === 'SEARCHING') {
        const elapsed = now - bot.moveStartTime;
        let progress = elapsed / bot.moveDuration;

        if (progress >= 1) {
          progress = 1;
          bot.x = bot.targetX;
          bot.y = bot.targetY;
          
          // Done searching, now actually pick a piece and move to it
          const targetPieces = piecesRef.current.filter(p => {
            if (p.is_snapped || p.locked_by) return false;
            if (isPieceGrouped(p)) return false;
            
            if (botMode === 'EDGE') {
              const { col, row } = getColRow(p.piece_id);
              const isEdge = col === 0 || col === GRID_COLS - 1 || row === 0 || row === GRID_ROWS - 1;
              if (!isEdge) return false;
              
              const isInside = p.current_x >= 0 && p.current_x <= BOARD_WIDTH - PIECE_WIDTH && 
                               p.current_y >= 0 && p.current_y <= BOARD_HEIGHT - PIECE_HEIGHT;
              
              return !isInside;
            } else {
              const zone = getColorZone(p.piece_id);
              
              const isInZone = p.current_x >= zone.x && p.current_x <= zone.x + zone.w &&
                               p.current_y >= zone.y && p.current_y <= zone.y + zone.h;
              
              if (isInZone) {
                const isOverlapping = piecesRef.current.some(other => {
                  if (other.piece_id === p.piece_id) return false;
                  const dx = p.current_x - other.current_x;
                  const dy = p.current_y - other.current_y;
                  return dx * dx + dy * dy < (PIECE_WIDTH * 1.6) * (PIECE_WIDTH * 1.6);
                });
                return isOverlapping;
              }
              return true;
            }
          });

          if (targetPieces.length > 0) {
            const piece = targetPieces[Math.floor(Math.random() * targetPieces.length)];
            bot.targetPieceId = piece.piece_id;
            setupBotMove(piece.current_x + PIECE_WIDTH / 2, piece.current_y + PIECE_HEIGHT / 2, 'MOVING_TO_PIECE');
          } else {
            bot.state = 'IDLE'; // Re-evaluate
          }
        } else {
          // Easing for searching (slow drift)
          // We can use easeOutQuad so it slows down as it searches
          const ease = 1 - (1 - progress) * (1 - progress);
          const t = ease;
          const mt = 1 - t;
          
          bot.x = mt * mt * bot.startX + 2 * mt * t * bot.controlX + t * t * bot.targetX;
          bot.y = mt * mt * bot.startY + 2 * mt * t * bot.controlY + t * t * bot.targetY;
        }
      } else if (bot.state === 'MOVING_TO_PIECE' || bot.state === 'DRAGGING_PIECE') {
        const elapsed = now - bot.moveStartTime;
        let progress = elapsed / bot.moveDuration;

        if (progress >= 1) {
          progress = 1;
          bot.x = bot.targetX;
          bot.y = bot.targetY;
          
          if (bot.state === 'MOVING_TO_PIECE') {
            // Reached piece, lock it
            const piece = piecesRef.current.find(p => p.piece_id === bot.targetPieceId);
            if (piece && !piece.locked_by && !piece.is_snapped && !isPieceGrouped(piece)) {
              // Lock piece
              piece.locked_by = bot.id;
              
              const node = stage.findOne(`#piece-${piece.piece_id}`);
              const otherDragLayer = stage.findOne('#other-drag-layer') as any;
              const idleLayer = stage.findOne('#idle-layer') as any;
              if (node && otherDragLayer && idleLayer) {
                node.moveTo(otherDragLayer);
                otherDragLayer.batchDraw();
                idleLayer.batchDraw();
              }

              // Emit lock event
              socket.emit('broadcast', {
                roomId: roomConfig.roomId,
                event: 'piece-lock',
                payload: { piece_ids: [piece.piece_id], locked_by: bot.id }
              });

              let targetPos = { x: 0, y: 0 };

              if (botMode === 'EDGE') {
                // Determine target inside board
                const { col, row } = getColRow(piece.piece_id);
                
                // We want to place them inside the board, near their respective edges
                let minX = 0;
                let maxX = Math.max(0, BOARD_WIDTH - PIECE_WIDTH);
                let minY = 0;
                let maxY = Math.max(0, BOARD_HEIGHT - PIECE_HEIGHT);
                
                if (row === 0) {
                  // Top edge
                  maxY = Math.min(maxY, PIECE_HEIGHT * 3);
                } else if (row === GRID_ROWS - 1) {
                  // Bottom edge
                  minY = Math.max(0, maxY - PIECE_HEIGHT * 3);
                } else if (col === 0) {
                  // Left edge
                  maxX = Math.min(maxX, PIECE_WIDTH * 3);
                } else if (col === GRID_COLS - 1) {
                  // Right edge
                  minX = Math.max(0, maxX - PIECE_WIDTH * 3);
                }
                
                const checkOverlap = (x: number, y: number) => {
                  return piecesRef.current.some(p => {
                    if (p.piece_id === piece.piece_id) return false;
                    const dx = x - p.current_x;
                    const dy = y - p.current_y;
                    return dx * dx + dy * dy < (PIECE_WIDTH * 1.6) * (PIECE_WIDTH * 1.6);
                  });
                };

                let found = false;
                const stepX = PIECE_WIDTH * 1.6;
                const stepY = PIECE_HEIGHT * 1.6;
                const cols = Math.max(1, Math.floor((maxX - minX) / stepX));
                const rows = Math.max(1, Math.floor((maxY - minY) / stepY));
                
                for (let r = 0; r < rows; r++) {
                  for (let c = 0; c < cols; c++) {
                    const testX = minX + c * stepX;
                    const testY = minY + r * stepY;
                    if (!checkOverlap(testX, testY)) {
                      targetPos = { x: testX, y: testY };
                      found = true;
                      break;
                    }
                  }
                  if (found) break;
                }
                
                if (!found) {
                  targetPos = {
                    x: minX + Math.random() * (maxX - minX),
                    y: minY + Math.random() * (maxY - minY)
                  };
                }
              } else {
                // COLOR mode
                const zone = getColorZone(piece.piece_id);
                
                const checkOverlap = (x: number, y: number) => {
                  return piecesRef.current.some(p => {
                    if (p.piece_id === piece.piece_id) return false;
                    const dx = x - p.current_x;
                    const dy = y - p.current_y;
                    return dx * dx + dy * dy < (PIECE_WIDTH * 1.6) * (PIECE_WIDTH * 1.6);
                  });
                };

                let found = false;
                const stepX = PIECE_WIDTH * 1.6;
                const stepY = PIECE_HEIGHT * 1.6;
                const cols = Math.floor(zone.w / stepX);
                const rows = Math.floor(zone.h / stepY);
                
                for (let r = 0; r < rows; r++) {
                  for (let c = 0; c < cols; c++) {
                    const testX = zone.x + c * stepX;
                    const testY = zone.y + r * stepY;
                    if (!checkOverlap(testX, testY)) {
                      targetPos = { x: testX, y: testY };
                      found = true;
                      break;
                    }
                  }
                  if (found) break;
                }
                
                if (!found) {
                  // Fallback to random if grid is full
                  targetPos = {
                    x: zone.x + Math.random() * (zone.w - PIECE_WIDTH),
                    y: zone.y + Math.random() * (zone.h - PIECE_HEIGHT)
                  };
                }
              }

              setupBotMove(targetPos.x + PIECE_WIDTH / 2, targetPos.y + PIECE_HEIGHT / 2, 'DRAGGING_PIECE');
            } else {
              // Piece was taken or snapped, abort
              bot.state = 'IDLE';
            }
          } else if (bot.state === 'DRAGGING_PIECE') {
            // Drop piece
            const piece = piecesRef.current.find(p => p.piece_id === bot.targetPieceId);
            if (piece && piece.locked_by === bot.id) {
              piece.locked_by = null;
              
              let finalX = bot.x - PIECE_WIDTH / 2;
              let finalY = bot.y - PIECE_HEIGHT / 2;
              
              const checkOverlap = (x: number, y: number) => {
                return piecesRef.current.some(p => {
                  if (p.piece_id === piece.piece_id) return false;
                  const dx = x - p.current_x;
                  const dy = y - p.current_y;
                  return dx * dx + dy * dy < (PIECE_WIDTH * 1.6) * (PIECE_WIDTH * 1.6);
                });
              };
              
              if (checkOverlap(finalX, finalY)) {
                let found = false;
                const stepX = PIECE_WIDTH * 1.6;
                const stepY = PIECE_HEIGHT * 1.6;

                if (botMode === 'EDGE') {
                  const { col, row } = getColRow(piece.piece_id);
                  let minX = 0;
                  let maxX = Math.max(0, BOARD_WIDTH - PIECE_WIDTH);
                  let minY = 0;
                  let maxY = Math.max(0, BOARD_HEIGHT - PIECE_HEIGHT);
                  
                  if (row === 0) maxY = Math.min(maxY, PIECE_HEIGHT * 3);
                  else if (row === GRID_ROWS - 1) minY = Math.max(0, maxY - PIECE_HEIGHT * 3);
                  else if (col === 0) maxX = Math.min(maxX, PIECE_WIDTH * 3);
                  else if (col === GRID_COLS - 1) minX = Math.max(0, maxX - PIECE_WIDTH * 3);

                  const cols = Math.max(1, Math.floor((maxX - minX) / stepX));
                  const rows = Math.max(1, Math.floor((maxY - minY) / stepY));
                  
                  for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                      const testX = minX + c * stepX;
                      const testY = minY + r * stepY;
                      if (!checkOverlap(testX, testY)) {
                        finalX = testX;
                        finalY = testY;
                        found = true;
                        break;
                      }
                    }
                    if (found) break;
                  }
                } else {
                  const zone = getColorZone(piece.piece_id);
                  const cols = Math.floor(zone.w / stepX);
                  const rows = Math.floor(zone.h / stepY);
                  
                  for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                      const testX = zone.x + c * stepX;
                      const testY = zone.y + r * stepY;
                      if (!checkOverlap(testX, testY)) {
                        finalX = testX;
                        finalY = testY;
                        found = true;
                        break;
                      }
                    }
                    if (found) break;
                  }
                }
              }

              piece.current_x = finalX;
              piece.current_y = finalY;

              const node = stage.findOne(`#piece-${piece.piece_id}`);
              const otherDragLayer = stage.findOne('#other-drag-layer') as any;
              const idleLayer = stage.findOne('#idle-layer') as any;
              if (node && otherDragLayer && idleLayer) {
                node.position({ x: piece.current_x, y: piece.current_y });
                node.moveTo(idleLayer);
                otherDragLayer.batchDraw();
                idleLayer.batchDraw();
              }

              // Emit drop event
              socket.emit('broadcast', {
                roomId: roomConfig.roomId,
                event: 'piece-drop',
                payload: { pieces: [{ piece_id: piece.piece_id, current_x: piece.current_x, current_y: piece.current_y, locked_by: null, is_snapped: false }] }
              });

              // Save to database
              socket.emit('upsert_pieces', {
                roomId: roomConfig.roomId,
                pieces: [{
                  piece_id: piece.piece_id,
                  current_x: piece.current_x,
                  current_y: piece.current_y,
                  locked_by: null,
                  is_snapped: false
                }]
              });
            }
            bot.state = 'IDLE';
          }
        } else {
          // Easing: easeInOutCubic
          const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          
          // Quadratic Bezier interpolation
          const t = ease;
          const mt = 1 - t;
          bot.x = mt * mt * bot.startX + 2 * mt * t * bot.controlX + t * t * bot.targetX;
          bot.y = mt * mt * bot.startY + 2 * mt * t * bot.controlY + t * t * bot.targetY;
          
          if (bot.state === 'DRAGGING_PIECE') {
            // Move piece
            const piece = piecesRef.current.find(p => p.piece_id === bot.targetPieceId);
            if (piece && piece.locked_by === bot.id) {
              piece.current_x = bot.x - PIECE_WIDTH / 2;
              piece.current_y = bot.y - PIECE_HEIGHT / 2;
              
              const node = stage.findOne(`#piece-${piece.piece_id}`);
              if (node) {
                node.position({ x: piece.current_x, y: piece.current_y });
                const otherDragLayer = stage.findOne('#other-drag-layer') as any;
                if (otherDragLayer) otherDragLayer.batchDraw();
              }

              // Emit move event periodically
              if (now - bot.lastMoveEmit > 50) {
                bot.lastMoveEmit = now;
                socket.emit('broadcast', {
                  roomId: roomConfig.roomId,
                  event: 'cursor-pos',
                  payload: { pieces: [{ piece_id: piece.piece_id, current_x: piece.current_x, current_y: piece.current_y }], locked_by: bot.id }
                });
              }
            }
          }
        }
      }

      // Update bot cursor locally
      const cursorsLayer = cursorsLayerRef.current;
      if (cursorsLayer) {
        let cursorGroup = cursorsLayer.findOne(`#cursor-${bot.id}`) as Konva.Group;
        if (!cursorGroup) {
          const invScale = 1 / stageScale.current;
          cursorGroup = new Konva.Group({
            id: `cursor-${bot.id}`,
            x: bot.x,
            y: bot.y,
            scaleX: invScale,
            scaleY: invScale,
          });

          const path = new Konva.Path({
            data: 'M5.5 22.5L2.5 2.5L22.5 9.5L13.5 13.5L5.5 22.5Z',
            fill: bot.color,
            stroke: 'white',
            strokeWidth: 2,
            shadowColor: 'black',
            shadowBlur: 4,
            shadowOffset: { x: 2, y: 2 },
            shadowOpacity: 0.3,
          });

          const text = new Konva.Text({
            text: bot.name,
            fill: 'white',
            fontSize: 14,
            fontFamily: 'sans-serif',
            fontStyle: 'bold',
            x: 15,
            y: 15,
            shadowColor: 'black',
            shadowBlur: 2,
            shadowOffset: { x: 1, y: 1 },
            shadowOpacity: 0.8,
          });

          cursorGroup.add(path);
          cursorGroup.add(text);
          cursorsLayer.add(cursorGroup);
        } else {
          cursorGroup.position({ x: bot.x, y: bot.y });
        }
        cursorsLayer.batchDraw();
      }

      // Emit mouse-move for bot periodically
      if (now - bot.lastMouseEmit > 50) {
        bot.lastMouseEmit = now;
        socket.emit('broadcast', {
          roomId: roomConfig.roomId,
          event: 'mouse-move',
          payload: { x: bot.x, y: bot.y, userId: bot.id, name: bot.name, color: bot.color }
        });
      }

      animationFrameId = requestAnimationFrame(botTick);
    };

    if (isBotRunning) {
      botRef.current.active = true;
      botRef.current.lastUpdate = Date.now();
      botRef.current.lastMoveEmit = 0;
      botRef.current.lastMouseEmit = 0;
      animationFrameId = requestAnimationFrame(botTick);
    } else {
      botRef.current.active = false;
      // Hide cursor
      const cursorsLayer = cursorsLayerRef.current;
      if (cursorsLayer) {
        const cursorGroup = cursorsLayer.findOne(`#cursor-${botRef.current.id}`);
        if (cursorGroup) {
          cursorGroup.destroy();
          cursorsLayer.batchDraw();
        }
      }
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isBotRunning, botMode, GRID_COLS, GRID_ROWS, BOARD_WIDTH, BOARD_HEIGHT, getColRow, roomConfig.roomId]);

  const startDraggingGroup = (pieceId: number, stage: Konva.Stage) => {
    const piece = piecesRef.current.find(p => p.piece_id === pieceId);
    if (!piece) return;
    if (piece.is_snapped || (piece.locked_by && piece.locked_by !== userId)) {
      return;
    }

    const groupIds = getConnectedGroup(piece.piece_id, piecesRef.current);
    draggingGroupRef.current = groupIds;

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

    piecesRef.current = piecesRef.current.map(p => 
      groupIds.includes(p.piece_id) ? { ...p, locked_by: userId } : p
    );

    socket.emit('broadcast', {
      roomId: roomConfig.roomId,
      event: 'piece-lock',
      payload: { piece_ids: groupIds, locked_by: userId },
    });
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>, piece: PuzzlePiece) => {
    const evt = e.evt as any;
    if (evt && evt.touches && evt.touches.length > 1) {
      e.target.stopDrag();
      return;
    }

    const stage = e.target.getStage();
    if (!stage) return;
    
    // If sticky drag is active, and we touched a different piece,
    // stop dragging the touched piece and start dragging the selected one.
    if (stickyDragRef.current && stickyDragRef.current.pieceId !== piece.piece_id) {
      e.target.stopDrag();
      
      const selectedPieceNode = stage.findOne(`#piece-${stickyDragRef.current.pieceId}`);
      if (selectedPieceNode) {
        const pointerId = evt.pointerId !== undefined ? evt.pointerId : (evt.changedTouches ? evt.changedTouches[0].identifier : undefined);
        if (pointerId !== undefined) {
          (selectedPieceNode as any).startDrag(pointerId);
        } else {
          (selectedPieceNode as any).startDrag();
        }
      }
      return;
    }
    
    startDraggingGroup(piece.piece_id, stage);
    if (draggingGroupRef.current.length === 0) {
      e.target.stopDrag();
    }
  };

  const broadcastCursorPosition = useCallback((stage: Konva.Stage | null) => {
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    let relativePos = {
      x: (pos.x - stage.x()) / stage.scaleX(),
      y: (pos.y - stage.y()) / stage.scaleY()
    };

    if (isTouchRef.current && draggingGroupRef.current.length > 0) {
      const primaryPieceId = draggingGroupRef.current[0];
      const node = stage.findOne(`#piece-${primaryPieceId}`);
      if (node) {
        relativePos = {
          x: node.x() + PIECE_WIDTH / 2,
          y: node.y() + PIECE_HEIGHT / 2
        };
      }
    }

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

  const moveDraggingGroup = (targetNode: Konva.Node, draggedPieceId: number) => {
    const groupIds = draggingGroupRef.current;
    if (groupIds.length === 0) return;

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
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const targetNode = e.target;
    const pieceIdStr = targetNode.id().replace('piece-', '');
    const draggedPieceId = parseInt(pieceIdStr, 10);
    
    moveDraggingGroup(targetNode, draggedPieceId);
    broadcastCursorPosition(e.target.getStage());

    // Auto-scroll when dragging near edge
    const stage = e.target.getStage();
    if (stage) {
      const stagePosObj = stage.position();
      const scale = stage.scaleX();
      const screenX = targetNode.x() * scale + stagePosObj.x;
      const screenY = targetNode.y() * scale + stagePosObj.y;
      
      const margin = 50; // Narrower margin
      const scrollSpeed = 5; // Constant speed, no acceleration
      let cameraMoved = false;
      let newStageX = stagePosObj.x;
      let newStageY = stagePosObj.y;
      
      if (screenX < margin) {
        newStageX += scrollSpeed;
        cameraMoved = true;
      } else if (screenX > dimensions.width - margin) {
        newStageX -= scrollSpeed;
        cameraMoved = true;
      }
      
      if (screenY < margin) {
        newStageY += scrollSpeed;
        cameraMoved = true;
      } else if (screenY > dimensions.height - margin) {
        newStageY -= scrollSpeed;
        cameraMoved = true;
      }
      
      if (cameraMoved) {
        stage.position({ x: newStageX, y: newStageY });
        stagePos.current = { x: newStageX, y: newStageY };
        stage.batchDraw();
      }
    }
  };

  const stopDraggingGroup = (stage: Konva.Stage, targetNode: Konva.Node, draggedPieceId: number) => {
    const groupIds = draggingGroupRef.current;
    if (groupIds.length === 0) return;

    const idleLayer = stage.findOne('#idle-layer') as any;
    const myDragLayer = stage.findOne('#my-drag-layer') as any;
    
    if (idleLayer && myDragLayer) {
      groupIds.forEach(id => {
        const node = stage.findOne(`#piece-${id}`);
        if (node) {
          node.moveTo(idleLayer);
        }
      });
      myDragLayer.batchDraw();
      idleLayer.batchDraw();
    }

    draggingGroupRef.current = [];

    const firstPiece = piecesRef.current.find(p => p.piece_id === draggedPieceId);
    if (!firstPiece || firstPiece.locked_by !== userId) return;

    const newX = targetNode.x();
    const newY = targetNode.y();
    const deltaX = newX - firstPiece.current_x;
    const deltaY = newY - firstPiece.current_y;

    if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) {
      if (selectedPieceId === draggedPieceId) {
        setSelectedPieceId(null);
      }
    }

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
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }

    if (newScore !== score) {
      setScore(newScore);
      socket.emit('update_score', { 
        roomId: roomConfig.roomId, 
        username, 
        score: newScore 
      });
    }

    if (isSnapped || snappedToAdjacent) {
      setSelectedPieceId(null);
    }

    piecesRef.current = piecesRef.current.map((p) => {
      const fp = finalPieces.find(f => f.piece_id === p.piece_id);
      if (fp) {
        return { ...p, current_x: fp.current_x, current_y: fp.current_y, locked_by: null, is_snapped: isSnapped };
      }
      return p;
    });

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

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const targetNode = e.target;
    const pieceIdStr = targetNode.id().replace('piece-', '');
    const draggedPieceId = parseInt(pieceIdStr, 10);
    
    stopDraggingGroup(stage, targetNode, draggedPieceId);
    stickyDragRef.current = null;
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

  const completedCount = piecesRef.current.filter(p => p.is_snapped).length;
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

  useEffect(() => {
    return () => {
    };
  }, []);

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

    const isSelected = selectedPieceId === piece.piece_id;

    return (
      <CachedGroup
        piece={piece}
        isSelected={isSelected}
        key={piece.piece_id}
        id={`piece-${piece.piece_id}`}
        name="piece-group"
        x={piece.current_x}
        y={piece.current_y}
        draggable={!piece.is_snapped && !isLockedByOther && (selectedPieceId === null || isSelected)}
        listening={!piece.is_snapped}
        onTap={(e) => {
          if (selectedPieceId !== null) return;
          
          if (!piece.is_snapped && !isLockedByOther) {
            const willSelect = !isSelected;
            setSelectedPieceId(willSelect ? piece.piece_id : null);
            if (willSelect) {
              e.currentTarget.moveToTop();
            }
            e.cancelBubble = true;
          }
        }}
        onClick={(e) => {
          if (isTouchRef.current) {
            if (selectedPieceId !== null) return;
            
            if (!piece.is_snapped && !isLockedByOther) {
              const willSelect = !isSelected;
              setSelectedPieceId(willSelect ? piece.piece_id : null);
              if (willSelect) {
                e.currentTarget.moveToTop();
              }
              e.cancelBubble = true;
            }
            return;
          }
          
          const stage = e.target.getStage();
          if (!stage) return;
          
          if (stickyDragRef.current) {
            const draggedPieceId = stickyDragRef.current.pieceId;
            const targetNode = stage.findOne(`#piece-${draggedPieceId}`);
            if (targetNode) {
              stopDraggingGroup(stage, targetNode, draggedPieceId);
            }
            stickyDragRef.current = null;
            setSelectedPieceId(null);
          } else {
            if (!piece.is_snapped && !isLockedByOther) {
              const pos = stage.getPointerPosition();
              if (pos) {
                const relativePos = {
                  x: (pos.x - stage.x()) / stage.scaleX(),
                  y: (pos.y - stage.y()) / stage.scaleY()
                };
                stickyDragRef.current = {
                  pieceId: piece.piece_id,
                  offsetX: relativePos.x - piece.current_x,
                  offsetY: relativePos.y - piece.current_y
                };
                startDraggingGroup(piece.piece_id, stage);
                setSelectedPieceId(piece.piece_id);
              }
            }
          }
          e.cancelBubble = true;
        }}
        onDragStart={(e) => {
          handleDragStart(e, piece);
        }}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        opacity={isLockedByOther ? 0.5 : 1}
      >
        {isSelected && (
          <Path
            data={pathData}
            stroke="#10b981"
            strokeWidth={4}
            shadowColor="#10b981"
            shadowBlur={10}
            shadowOpacity={0.8}
            x={-tabSize}
            y={-tabSize}
          />
        )}
        {pieceImage && (
          <KonvaImage
            image={pieceImage}
            x={-tabSize}
            y={-tabSize}
            perfectDrawEnabled={false}
          />
        )}
      </CachedGroup>
    );
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

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const handleMinimapPointerDown = (e: React.PointerEvent) => {
    minimapDragRef.current = { 
      startX: e.clientX, 
      startY: e.clientY, 
      lastX: e.clientX, 
      lastY: e.clientY, 
      isDragging: false 
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleMinimapPointerMove = (e: React.PointerEvent) => {
    if (!minimapDragRef.current) return;
    
    const dx = e.clientX - minimapDragRef.current.lastX;
    const dy = e.clientY - minimapDragRef.current.lastY;
    
    const totalDx = e.clientX - minimapDragRef.current.startX;
    const totalDy = e.clientY - minimapDragRef.current.startY;
    
    if (!minimapDragRef.current.isDragging && (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5)) {
      minimapDragRef.current.isDragging = true;
    }
    
    if (minimapDragRef.current.isDragging) {
      const multiplier = 2.5; // Adjust speed for touchpad feel
      
      if (stageRef.current) {
        const stage = stageRef.current;
        const newPos = {
          x: stage.x() + dx * multiplier,
          y: stage.y() + dy * multiplier
        };
        stage.position(newPos);
        stage.batchDraw();
        stagePos.current = newPos;
      }
    }
    
    minimapDragRef.current.lastX = e.clientX;
    minimapDragRef.current.lastY = e.clientY;
  };

  const handleMinimapPointerUp = (e: React.PointerEvent) => {
    if (!minimapDragRef.current) return;
    
    if (!minimapDragRef.current.isDragging) {
      setShowLargePreview(true);
    }
    
    minimapDragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
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
          <div className="flex items-center gap-2 bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700 pointer-events-auto">
            <span className="text-slate-300 text-sm whitespace-nowrap">봇 속도: {botSpeed}</span>
            <input 
              type="range" 
              min="1" 
              max="10" 
              value={botSpeed} 
              onChange={(e) => setBotSpeed(parseInt(e.target.value))}
              className="w-24 accent-indigo-500"
            />
          </div>
          <button
            onClick={() => {
              if (isBotRunning && botMode === 'EDGE') {
                setIsBotRunning(false);
              } else {
                setBotMode('EDGE');
                setIsBotRunning(true);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors pointer-events-auto ${
              isBotRunning && botMode === 'EDGE'
                ? 'bg-fuchsia-600/80 hover:bg-fuchsia-500 border-fuchsia-500/50 text-white' 
                : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'
            }`}
          >
            <Bot className="w-4 h-4" />
            {isBotRunning && botMode === 'EDGE' ? '봇 중지' : '테두리 찾기'}
          </button>
          
          <button
            onClick={() => {
              if (isBotRunning && botMode === 'COLOR') {
                setIsBotRunning(false);
              } else {
                setBotMode('COLOR');
                setIsBotRunning(true);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors pointer-events-auto ${
              isBotRunning && botMode === 'COLOR'
                ? 'bg-emerald-600/80 hover:bg-emerald-500 border-emerald-500/50 text-white' 
                : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'
            }`}
          >
            <Bot className="w-4 h-4" />
            {isBotRunning && botMode === 'COLOR' ? '봇 중지' : '색상별 모으기'}
          </button>
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
            <PlayTimeDisplay />
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
        onMouseMove={(e) => {
          const stage = e.target.getStage();
          if (!stage) return;
          
          if (!isTouchRef.current && stickyDragRef.current) {
            const pos = stage.getPointerPosition();
            if (pos) {
              const relativePos = {
                x: (pos.x - stage.x()) / stage.scaleX(),
                y: (pos.y - stage.y()) / stage.scaleY()
              };
              const { pieceId, offsetX, offsetY } = stickyDragRef.current;
              const newX = relativePos.x - offsetX;
              const newY = relativePos.y - offsetY;
              
              const targetNode = stage.findOne(`#piece-${pieceId}`);
              if (targetNode) {
                targetNode.position({ x: newX, y: newY });
                moveDraggingGroup(targetNode, pieceId);
              }
            }
          }
          broadcastCursorPosition(stage);
        }}
        draggable={selectedPieceId === null}
        onPointerDown={(e) => {
          const evt = e.evt as any;
          isTouchRef.current = evt.pointerType === 'touch' || evt.type.includes('touch');
          
          if (isTouchRef.current && selectedPieceId !== null) {
            const stage = stageRef.current;
            if (!stage) return;
            const node = stage.findOne(`#piece-${selectedPieceId}`);
            if (node && !node.isDragging()) {
              const pointerId = evt.pointerId !== undefined ? evt.pointerId : (evt.changedTouches ? evt.changedTouches[0].identifier : undefined);
              if (pointerId !== undefined) {
                node.startDrag(pointerId);
              } else {
                node.startDrag();
              }
            }
          }
        }}
        onTap={() => {
          if (selectedPieceId !== null) {
            setSelectedPieceId(null);
          }
        }}
        onClick={(e) => {
          if (!isTouchRef.current && stickyDragRef.current) {
            const stage = e.target.getStage();
            if (stage) {
              const draggedPieceId = stickyDragRef.current.pieceId;
              const targetNode = stage.findOne(`#piece-${draggedPieceId}`);
              if (targetNode) {
                stopDraggingGroup(stage, targetNode, draggedPieceId);
              }
              stickyDragRef.current = null;
            }
          }
          if (selectedPieceId !== null) {
            setSelectedPieceId(null);
          }
        }}
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
            name="board-background"
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
              name="board-background"
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
          {piecesRef.current.filter(p => p.is_snapped).map(renderPiece)}
        </Layer>

        <Layer id="idle-layer">
          {piecesRef.current.filter(p => !p.is_snapped).map(renderPiece)}
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
        <button
          onClick={toggleFullscreen}
          className="bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md p-3 rounded-full border border-slate-700 text-slate-300 shadow-lg transition-colors"
          aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
        </button>
      </div>

      {/* Minimap for all puzzles */}
      {image && (
        <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2">
          <div className="bg-slate-800/80 backdrop-blur-md p-2 rounded-xl border border-slate-700 shadow-lg pointer-events-auto">
            <div 
              className="relative group cursor-pointer touch-none" 
              onPointerDown={handleMinimapPointerDown}
              onPointerMove={handleMinimapPointerMove}
              onPointerUp={handleMinimapPointerUp}
              onPointerCancel={handleMinimapPointerUp}
              title="Drag to pan, tap to view original"
            >
              <img 
                src={roomConfig.imageUrl} 
                alt="Puzzle Preview" 
                className="w-32 h-auto rounded-lg opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none"
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-lg pointer-events-none">
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
