import React from 'react';

interface MinimapProps {
  image: HTMLImageElement | null;
  stageScale: number;
  stagePos: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  puzzleWidth: number;
  puzzleHeight: number;
}

export default function Minimap({ image, stageScale, stagePos, containerWidth, containerHeight, puzzleWidth, puzzleHeight }: MinimapProps) {
  if (!image) return null;

  const minimapWidth = 200;
  const minimapHeight = (image.height / image.width) * minimapWidth;

  // Calculate viewport dimensions and position
  // The viewport represents the visible area of the puzzle board
  const viewportWidth = (containerWidth / stageScale) * (minimapWidth / puzzleWidth);
  const viewportHeight = (containerHeight / stageScale) * (minimapHeight / puzzleHeight);

  const viewportX = (-stagePos.x / stageScale) * (minimapWidth / puzzleWidth);
  const viewportY = (-stagePos.y / stageScale) * (minimapHeight / puzzleHeight);

  return (
    <div className="absolute bottom-4 right-4 bg-slate-900/80 p-2 rounded-lg border border-slate-700 pointer-events-none z-30">
      <div className="relative" style={{ width: minimapWidth, height: minimapHeight }}>
        <img src={image.src} className="w-full h-full object-cover" alt="Minimap" />
        <div 
          className="absolute border-2 border-indigo-500 bg-indigo-500/20"
          style={{
            width: viewportWidth,
            height: viewportHeight,
            left: viewportX,
            top: viewportY
          }}
        />
      </div>
    </div>
  );
}
