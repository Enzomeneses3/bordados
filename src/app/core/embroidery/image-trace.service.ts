import { Injectable } from '@angular/core';
import { findNearestJefIndex, JEF_THREAD_PALETTE } from '../constants/jef-colors';
import {
  BackgroundImage,
  DesignShape,
  EmbroideryDesign,
  HOOP_DIMENSIONS,
  HoopSize,
  ImageTraceOptions,
  ImageTraceResult,
  ThreadColor,
} from '../../models/embroidery.model';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface CellAverage extends Rgb {
  coverage: number;
}

interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function createId(): string {
  return crypto.randomUUID();
}

function colorDistance(a: Rgb, b: Rgb): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo cargar la imagen'));
    };
    img.src = url;
  });
}

function extractPalette(samples: Rgb[], maxColors: number): Rgb[] {
  if (samples.length === 0) {
    return [{ r: 0, g: 0, b: 0 }];
  }

  const palette: Rgb[] = [samples[0]];
  for (const sample of samples) {
    const nearest = palette.reduce(
      (best, color) => {
        const distance = colorDistance(sample, color);
        return distance < best.distance ? { color, distance } : best;
      },
      { color: palette[0], distance: Number.MAX_VALUE },
    );

    if (nearest.distance > 4500 && palette.length < maxColors) {
      palette.push(sample);
    } else if (nearest.distance > 4500) {
      let farthestIndex = 0;
      let farthestDistance = -1;
      for (let i = 0; i < palette.length; i++) {
        const minDist = palette.reduce((min, color) => Math.min(min, colorDistance(palette[i], color)), Number.MAX_VALUE);
        if (minDist > farthestDistance) {
          farthestDistance = minDist;
          farthestIndex = i;
        }
      }
      palette[farthestIndex] = sample;
    }
  }

  return palette.slice(0, maxColors);
}

function getPixel(data: Uint8ClampedArray, width: number, x: number, y: number): Rgb & { alpha: number } {
  const offset = (y * width + x) * 4;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    alpha: data[offset + 3],
  };
}

function estimateBackground(data: Uint8ClampedArray, width: number, height: number): Rgb | null {
  const corners = [
    getPixel(data, width, 0, 0),
    getPixel(data, width, width - 1, 0),
    getPixel(data, width, 0, height - 1),
    getPixel(data, width, width - 1, height - 1),
  ].filter((pixel) => pixel.alpha >= 40);

  if (corners.length === 0) {
    return null;
  }

  return {
    r: Math.round(corners.reduce((sum, pixel) => sum + pixel.r, 0) / corners.length),
    g: Math.round(corners.reduce((sum, pixel) => sum + pixel.g, 0) / corners.length),
    b: Math.round(corners.reduce((sum, pixel) => sum + pixel.b, 0) / corners.length),
  };
}

function isForegroundPixel(pixel: Rgb & { alpha: number }, background: Rgb | null): boolean {
  if (pixel.alpha < 40) {
    return false;
  }

  if (!background) {
    return true;
  }

  // PNGs with a white canvas need background removal before creating embroidery regions.
  return colorDistance(pixel, background) > 1800;
}

function averageForegroundCell(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  startX: number,
  startY: number,
  size: number,
  background: Rgb | null,
): CellAverage | null {
  let total = 0;
  let foreground = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (let y = startY; y < Math.min(startY + size, imageHeight); y++) {
    for (let x = startX; x < Math.min(startX + size, imageWidth); x++) {
      total++;
      const pixel = getPixel(data, imageWidth, x, y);
      if (!isForegroundPixel(pixel, background)) {
        continue;
      }

      foreground++;
      r += pixel.r;
      g += pixel.g;
      b += pixel.b;
    }
  }

  if (foreground === 0 || foreground / total < 0.06) {
    return null;
  }

  return {
    r: Math.round(r / foreground),
    g: Math.round(g / foreground),
    b: Math.round(b / foreground),
    coverage: foreground / total,
  };
}

function findForegroundBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: Rgb | null,
): PixelBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = getPixel(data, width, x, y);
      if (!isForegroundPixel(pixel, background)) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function expandBounds(bounds: PixelBounds, imageWidth: number, imageHeight: number): PixelBounds {
  const padding = Math.max(4, Math.round(Math.max(bounds.width, bounds.height) * 0.06));
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(imageWidth, bounds.x + bounds.width + padding);
  const bottom = Math.min(imageHeight, bounds.y + bounds.height + padding);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function nearestPaletteIndex(pixel: Rgb, palette: Rgb[]): number {
  let bestIndex = 0;
  let bestDistance = Number.MAX_VALUE;
  for (let i = 0; i < palette.length; i++) {
    const distance = colorDistance(pixel, palette[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function mergeRects(grid: number[][], width: number, height: number, colorIndex: number): PixelRect[] {
  const used = Array.from({ length: height }, () => Array(width).fill(false));
  const rects: PixelRect[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (used[y][x] || grid[y][x] !== colorIndex) {
        continue;
      }

      let w = 1;
      while (x + w < width && grid[y][x + w] === colorIndex && !used[y][x + w]) {
        w++;
      }

      let h = 1;
      let canGrow = true;
      while (canGrow && y + h < height) {
        for (let dx = 0; dx < w; dx++) {
          if (grid[y + h][x + dx] !== colorIndex || used[y + h][x + dx]) {
            canGrow = false;
            break;
          }
        }
        if (canGrow) {
          h++;
        }
      }

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          used[y + dy][x + dx] = true;
        }
      }

      rects.push({ x, y, w, h });
    }
  }

  return rects;
}

export function findConnectedComponents(grid: number[][], width: number, height: number, colorIndex: number): number[][][] {
  const components: number[][][] = [];
  const visited = Array.from({ length: height }, () => new Uint8Array(width));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === colorIndex && visited[y][x] === 0) {
        const compGrid = Array.from({ length: height }, () => Array(width).fill(-1));
        const stack: {x: number, y: number}[] = [{x, y}];
        visited[y][x] = 1;
        compGrid[y][x] = colorIndex;
        let count = 1;

        while (stack.length > 0) {
          const curr = stack.pop()!;
          const neighbors = [
            {cx: curr.x + 1, cy: curr.y},
            {cx: curr.x - 1, cy: curr.y},
            {cx: curr.x, cy: curr.y + 1},
            {cx: curr.x, cy: curr.y - 1},
            {cx: curr.x + 1, cy: curr.y + 1},
            {cx: curr.x - 1, cy: curr.y - 1},
            {cx: curr.x + 1, cy: curr.y - 1},
            {cx: curr.x - 1, cy: curr.y + 1},
          ];

          for (const n of neighbors) {
            if (n.cx >= 0 && n.cx < width && n.cy >= 0 && n.cy < height) {
              if (grid[n.cy][n.cx] === colorIndex && visited[n.cy][n.cx] === 0) {
                visited[n.cy][n.cx] = 1;
                compGrid[n.cy][n.cx] = colorIndex;
                stack.push({ x: n.cx, y: n.cy });
                count++;
              }
            }
          }
        }
        
        if (count > 4) {
          components.push(compGrid);
        }
      }
    }
  }
  return components;
}

export function traceMooreNeighborhood(
  grid: number[][],
  width: number,
  height: number,
  colorIndex: number
): { x: number; y: number }[] {
  let startX = -1, startY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === colorIndex) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) return [];

  const dx = [ 0,  1,  1,  1,  0, -1, -1, -1];
  const dy = [-1, -1,  0,  1,  1,  1,  0, -1];

  let currX = startX;
  let currY = startY;
  let dir = 7; 
  const contour: {x: number, y: number}[] = [];
  
  let steps = 0;
  const maxSteps = width * height * 2;

  do {
    contour.push({ x: currX, y: currY });
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + i) % 8;
      const nx = currX + dx[checkDir];
      const ny = currY + dy[checkDir];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === colorIndex) {
        currX = nx;
        currY = ny;
        dir = (checkDir + 6) % 8; 
        found = true;
        break;
      }
    }
    if (!found) break;
    steps++;
  } while ((currX !== startX || currY !== startY) && steps < maxSteps);

  return contour;
}

export function smoothContour(points: {x: number, y: number}[], iterations = 3): {x: number, y: number}[] {
  if (points.length < 4) return points;
  let result = [...points];
  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    for (let i = 0; i < result.length; i++) {
      const prev = result[(i - 1 + result.length) % result.length];
      const curr = result[i];
      const nxt = result[(i + 1) % result.length];
      next.push({
        x: (prev.x + curr.x * 2 + nxt.x) / 4,
        y: (prev.y + curr.y * 2 + nxt.y) / 4,
      });
    }
    result = next;
  }
  return result;
}

export function resamplePath(points: {x: number, y: number}[], spacing: number): {x: number, y: number}[] {
  if (points.length < 2) return points;
  const result = [points[0]];
  let distSinceLast = 0;
  
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLen = Math.hypot(dx, dy);
    
    let distOnSeg = spacing - distSinceLast;
    
    while (distOnSeg <= segLen) {
      const t = distOnSeg / segLen;
      result.push({
        x: p1.x + dx * t,
        y: p1.y + dy * t
      });
      distOnSeg += spacing;
    }
    
    distSinceLast = segLen - (distOnSeg - spacing);
  }
  return result;
}

/** Relleno tipo tatami sobre la máscara de cada color (puntadas reales proporcionales al área). */
export function generateFillStitchesFromMask(
  grid: number[][],
  gridWidth: number,
  gridHeight: number,
  colorIndex: number,
  drawWidth: number,
  drawHeight: number,
  detail: number,
): { points: { x: number; y: number }[]; jumps: number[] } {
  const unitPerCellX = drawWidth / gridWidth;
  const unitPerCellY = drawHeight / gridHeight;
  const originX = -drawWidth / 2;
  const originY = -drawHeight / 2;
  const stitchSpacing = Math.max(unitPerCellX * 0.5, 3.5 - detail * 0.2);

  const points: { x: number; y: number }[] = [];
  const jumps: number[] = [];
  let reverse = false;

  for (let gy = 0; gy < gridHeight; gy++) {
    const rowY = originY + (gy + 0.5) * unitPerCellY;
    const segments: { x1: number; x2: number }[] = [];
    let inRun = false;
    let runStart = 0;

    for (let gx = 0; gx < gridWidth; gx++) {
      const filled = grid[gy][gx] === colorIndex;
      if (filled && !inRun) {
        inRun = true;
        runStart = gx;
      } else if (!filled && inRun) {
        inRun = false;
        segments.push({
          x1: originX + runStart * unitPerCellX,
          x2: originX + gx * unitPerCellX,
        });
      }
    }
    if (inRun) {
      segments.push({
        x1: originX + runStart * unitPerCellX,
        x2: originX + gridWidth * unitPerCellX,
      });
    }

    if (segments.length === 0) {
      continue;
    }

    const ordered = reverse ? [...segments].reverse() : segments;
    for (const seg of ordered) {
      const xStart = reverse ? seg.x2 : seg.x1;
      const xEnd = reverse ? seg.x1 : seg.x2;
      const length = Math.abs(xEnd - xStart);
      const steps = Math.max(1, Math.ceil(length / stitchSpacing));

      for (let step = 0; step <= steps; step++) {
        if (step === 0 && points.length > 0) {
          jumps.push(points.length);
        }
        const t = step / steps;
        points.push({
          x: xStart + (xEnd - xStart) * t,
          y: rowY,
        });
      }
    }
    reverse = !reverse;
  }

  return { points, jumps };
}

function countStitchPointsInShape(shape: DesignShape): number {
  if (shape.type === 'stitchpath' && shape.points?.length) {
    const jumps = new Set(shape.jumps ?? []);
    return shape.points.filter((_, index) => !jumps.has(index)).length;
  }
  return 0;
}

export function estimateShapeStitchCount(shape: DesignShape): number {
  if (shape.type === 'stitchpath') {
    return countStitchPointsInShape(shape);
  }
  const spacing = 25;
  const lineSpacing = 40;
  if (shape.stitchType === 'fill') {
    const lines = Math.max(1, Math.ceil(shape.height / lineSpacing));
    const perLine = Math.max(1, Math.ceil(shape.width / spacing));
    return lines * perLine;
  }
  if (shape.stitchType === 'satin') {
    const lines = Math.max(1, Math.ceil(shape.height / spacing));
    return lines * 2;
  }
  const perimeter = 2 * (shape.width + shape.height);
  return Math.max(1, Math.ceil(perimeter / spacing));
}

@Injectable({ providedIn: 'root' })
export class ImageTraceService {
  async traceImage(file: File, hoopSize: HoopSize, options: ImageTraceOptions): Promise<ImageTraceResult> {
    const image = await loadImage(file);
    const hoop = HOOP_DIMENSIONS[hoopSize];
    const maxDesignWidth = hoop.width * 0.82;
    const maxDesignHeight = hoop.height * 0.82;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.naturalWidth || image.width;
    sourceCanvas.height = image.naturalHeight || image.height;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
    sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const sourceImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const sourceBackground = estimateBackground(sourceImageData.data, sourceCanvas.width, sourceCanvas.height);
    const detectedBounds = findForegroundBounds(
      sourceImageData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      sourceBackground,
    );
    const cropBounds = detectedBounds
      ? expandBounds(detectedBounds, sourceCanvas.width, sourceCanvas.height)
      : { x: 0, y: 0, width: sourceCanvas.width, height: sourceCanvas.height };

    const scale = Math.min(maxDesignWidth / cropBounds.width, maxDesignHeight / cropBounds.height);
    const drawWidth = Math.max(1, Math.round(cropBounds.width * scale));
    const drawHeight = Math.max(1, Math.round(cropBounds.height * scale));

    const DPI = 4;
    const canvasWidth = Math.max(10, Math.round(drawWidth * DPI));
    const canvasHeight = Math.max(10, Math.round(drawHeight * DPI));

    const cellSizePx = Math.max(2, Math.round((12 - options.detail) * 1.2));
    const gridWidth = Math.max(1, Math.ceil(canvasWidth / cellSizePx));
    const gridHeight = Math.max(1, Math.ceil(canvasHeight / cellSizePx));

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(
      image,
      cropBounds.x,
      cropBounds.y,
      cropBounds.width,
      cropBounds.height,
      0,
      0,
      canvasWidth,
      canvasHeight,
    );
    const { data } = ctx.getImageData(0, 0, canvasWidth, canvasHeight);

    const background = sourceBackground ?? estimateBackground(data, canvasWidth, canvasHeight);
    const cells: (CellAverage | null)[][] = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(null));
    const samples: Rgb[] = [];

    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const average = averageForegroundCell(
          data,
          canvasWidth,
          canvasHeight,
          gx * cellSizePx,
          gy * cellSizePx,
          cellSizePx,
          background,
        );

        cells[gy][gx] = average;
        if (average) {
          samples.push(average);
        }
      }
    }

    const palette = extractPalette(samples, options.maxColors);
    const colorIds = palette.map((color, index) => {
      const hex = rgbToHex(color);
      const jefIndex = findNearestJefIndex(hex);
      const jefThread = JEF_THREAD_PALETTE.find(t => t.index === jefIndex) || JEF_THREAD_PALETTE[1];
      const snap = options.snapToRealThreads;
      return {
        id: createId(),
        name: snap ? jefThread.name : `Color ${index + 1}`,
        hex: snap ? rgbToHex({ r: jefThread.r, g: jefThread.g, b: jefThread.b }) : hex,
        jefIndex: jefIndex,
      };
    });

    const grid: number[][] = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(-1));

    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const average = cells[gy][gx];
        if (!average) {
          grid[gy][gx] = -1;
          continue;
        }
        grid[gy][gx] = nearestPaletteIndex(average, palette);
      }
    }

    const unitPerCellX = drawWidth / gridWidth;
    const unitPerCellY = drawHeight / gridHeight;
    const shapes: DesignShape[] = [];

    for (let colorIndex = 0; colorIndex < palette.length; colorIndex++) {
      const hasCells = grid.some((row) => row.some((cell) => cell === colorIndex));
      if (!hasCells) {
        continue;
      }

      if (options.stitchType === 'fill') {
        const components = findConnectedComponents(grid, gridWidth, gridHeight, colorIndex);
        
        for (let i = 0; i < components.length; i++) {
          const compGrid = components[i];
          const { points, jumps } = generateFillStitchesFromMask(
            compGrid,
            gridWidth,
            gridHeight,
            colorIndex,
            drawWidth,
            drawHeight,
            options.detail,
          );
          if (points.length < 4) {
            continue;
          }
          
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for(const pt of points) {
             minX = Math.min(minX, pt.x);
             minY = Math.min(minY, pt.y);
             maxX = Math.max(maxX, pt.x);
             maxY = Math.max(maxY, pt.y);
          }
          const compW = Math.max(1, maxX - minX);
          const compH = Math.max(1, maxY - minY);
          const cx = minX + compW / 2;
          const cy = minY + compH / 2;
          const relativePoints = points.map(p => ({ x: p.x - cx, y: p.y - cy }));
          const componentGroupId = createId();

          shapes.push({
            id: createId(),
            type: 'stitchpath',
            x: cx,
            y: cy,
            width: compW,
            height: compH,
            rotation: 0,
            colorId: colorIds[colorIndex].id,
            stitchType: 'fill',
            label: `Relleno ${colorIndex + 1} (Parte ${i + 1})`,
            source: 'trace',
            points: relativePoints,
            jumps,
            groupId: componentGroupId,
          });

          // Agregar un contorno (running stitch) automático para suavizar los bordes del tatami
          const boundaryGridPixels = traceMooreNeighborhood(compGrid, gridWidth, gridHeight, colorIndex);
          if (boundaryGridPixels.length > 8) {
            const smoothedGrid = smoothContour(boundaryGridPixels, 3);
            const originX = -drawWidth / 2;
            const originY = -drawHeight / 2;
            const boundaryPoints = smoothedGrid.map(p => ({
              x: originX + (p.x + 0.5) * unitPerCellX,
              y: originY + (p.y + 0.5) * unitPerCellY,
            }));
            
            // Cerrar el loop
            boundaryPoints.push({ ...boundaryPoints[0] });

            // 20 = 2.0mm de separación entre puntadas del contorno
            const resampledBoundary = resamplePath(boundaryPoints, 20);

            if (resampledBoundary.length > 3) {
              let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
              for(const pt of resampledBoundary) {
                 bMinX = Math.min(bMinX, pt.x);
                 bMinY = Math.min(bMinY, pt.y);
                 bMaxX = Math.max(bMaxX, pt.x);
                 bMaxY = Math.max(bMaxY, pt.y);
              }
              const bCompW = Math.max(1, bMaxX - bMinX);
              const bCompH = Math.max(1, bMaxY - bMinY);
              const bcx = bMinX + bCompW / 2;
              const bcy = bMinY + bCompH / 2;

              const bRelativePoints = resampledBoundary.map(p => ({ x: p.x - bcx, y: p.y - bcy }));

              shapes.push({
                id: createId(),
                type: 'stitchpath',
                x: bcx,
                y: bcy,
                width: bCompW,
                height: bCompH,
                rotation: 0,
                colorId: colorIds[colorIndex].id,
                stitchType: 'running',
                label: `Contorno ${colorIndex + 1} (Parte ${i + 1})`,
                source: 'trace',
                points: bRelativePoints,
                jumps: [],
                groupId: componentGroupId,
              });
            }
          }
        }
        continue;
      }

      const rects = mergeRects(grid, gridWidth, gridHeight, colorIndex);
      for (const rect of rects) {
        const widthUnits = rect.w * unitPerCellX;
        const heightUnits = rect.h * unitPerCellY;
        if (widthUnits < 6 || heightUnits < 6) {
          continue;
        }

        const centerX = -drawWidth / 2 + (rect.x + rect.w / 2) * unitPerCellX;
        const centerY = -drawHeight / 2 + (rect.y + rect.h / 2) * unitPerCellY;

        shapes.push({
          id: createId(),
          type: 'rect',
          x: centerX,
          y: centerY,
          width: widthUnits,
          height: heightUnits,
          rotation: 0,
          colorId: colorIds[colorIndex].id,
          stitchType: options.stitchType,
          label: `Región ${colorIndex + 1}`,
          source: 'trace',
        });
      }
    }

    const backgroundImage: BackgroundImage | null = options.keepBackground
      ? {
          src: canvas.toDataURL('image/png'),
          x: 0,
          y: 0,
          width: drawWidth,
          height: drawHeight,
          opacity: 0.45,
          visible: true,
        }
      : null;

    return {
      name: file.name.replace(/\.[^.]+$/, ''),
      colors: colorIds,
      shapes,
      backgroundImage,
    };
  }

  applyTraceToDesign(design: EmbroideryDesign, result: ImageTraceResult, replaceTraced: boolean): EmbroideryDesign {
    const manualShapes = replaceTraced ? design.shapes.filter((shape) => shape.source !== 'trace') : design.shapes;
    const manualColors = replaceTraced ? design.colors.filter((color) => !result.colors.some((c) => c.hex === color.hex)) : design.colors;
    const mergedColors = [...manualColors];
    const colorRemap = new Map<string, string>();

    for (const tracedColor of result.colors) {
      const existing = mergedColors.find((color) => color.hex.toLowerCase() === tracedColor.hex.toLowerCase());
      if (existing) {
        colorRemap.set(tracedColor.id, existing.id);
      } else {
        mergedColors.push(tracedColor);
        colorRemap.set(tracedColor.id, tracedColor.id);
      }
    }

    const tracedShapes = result.shapes.map((shape) => ({
      ...shape,
      colorId: colorRemap.get(shape.colorId) ?? shape.colorId,
    }));

    return {
      ...design,
      name: result.name || design.name,
      colors: mergedColors,
      shapes: [...manualShapes, ...tracedShapes],
      backgroundImage: result.backgroundImage,
    };
  }
}
