
import React, { useEffect, useRef } from 'react';
import { drawBeveledPuzzlePiece } from '../utils/bevelEffect';

export default function BevelTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = 'https://picsum.photos/seed/puzzle/400/400';
    img.onload = () => {
      const path = new Path2D();
      path.rect(50, 50, 300, 300); // Simple square for testing
      
      drawBeveledPuzzlePiece(ctx, img, path, 50, 50, 300, 300, 300, 300);
    };
  }, []);

  return <canvas ref={canvasRef} width={400} height={400} />;
}
