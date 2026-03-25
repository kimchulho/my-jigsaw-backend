
export function drawBeveledPuzzlePiece(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  path: Path2D,
  x: number,
  y: number,
  width: number,
  height: number,
  pieceWidth: number,
  pieceHeight: number
) {
  ctx.save();
  ctx.translate(x, y);

  // 1. Draw the part of the image you want to use for the piece positioned correctly
  ctx.save();
  ctx.clip(path);
  ctx.drawImage(image, -x, -y, width, height);
  ctx.restore();

  // 2. Build a path for the puzzle piece (already passed as 'path')

  // 3. Punch out the piece using composite mode destination-in
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fill(path);
  ctx.restore();

  // 4. Add rect/bounding box to path (for shadow)
  // This is a bit ambiguous, but I'll interpret it as adding a shadow effect.
  
  // 5. Define dark shadow and fill using composite mode source-atop
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 5;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill(path);
  ctx.restore();

  // 6. Move shadow and change color to bright, fill again
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.shadowColor = 'rgba(255,255,255,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = -5;
  ctx.shadowOffsetY = -5;
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fill(path);
  ctx.restore();

  ctx.restore();
}
