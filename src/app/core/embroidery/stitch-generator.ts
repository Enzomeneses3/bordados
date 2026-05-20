import {
  COMMAND_MASK,
  DesignShape,
  EmbroideryDesign,
  STITCH_COMMAND,
  StitchPoint,
  ThreadColor,
} from '../../models/embroidery.model';
import {
  findConnectedComponents,
  traceMooreNeighborhood,
  smoothContour,
  resamplePath,
  generateFillStitchesFromMask,
} from './image-trace.service';

const STITCH_SPACING = 25;
const FILL_LINE_SPACING = 40;

function rotatePoint(x: number, y: number, cx: number, cy: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function rectPoints(shape: DesignShape): { x: number; y: number }[] {
  const left = shape.x - shape.width / 2;
  const top = shape.y - shape.height / 2;
  const right = shape.x + shape.width / 2;
  const bottom = shape.y + shape.height / 2;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ];
  return corners.map((p) => rotatePoint(p.x, p.y, shape.x, shape.y, shape.rotation));
}

function ellipsePoints(shape: DesignShape, segments = 48): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = shape.x + (Math.cos(t) * shape.width) / 2;
    const y = shape.y + (Math.sin(t) * shape.height) / 2;
    points.push(rotatePoint(x, y, shape.x, shape.y, shape.rotation));
  }
  return points;
}

function linePoints(shape: DesignShape): { x: number; y: number }[] {
  const halfW = shape.width / 2;
  const p1 = rotatePoint(shape.x - halfW, shape.y, shape.x, shape.y, shape.rotation);
  const p2 = rotatePoint(shape.x + halfW, shape.y, shape.x, shape.y, shape.rotation);
  return [p1, p2];
}

function textPoints(shape: DesignShape): { x: number; y: number }[] {
  const text = shape.text?.trim() || 'ABC';
  const charWidth = Math.max(shape.width / Math.max(text.length, 1), 30);
  const baselineY = shape.y + shape.height / 4;
  const startX = shape.x - (text.length * charWidth) / 2;
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < text.length; i++) {
    const cx = startX + i * charWidth + charWidth / 2;
    const left = cx - charWidth * 0.35;
    const right = cx + charWidth * 0.35;
    const top = baselineY - shape.height * 0.6;
    const bottom = baselineY;
    const letter = [
      { x: left, y: bottom },
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
    ].map((p) => rotatePoint(p.x, p.y, shape.x, shape.y, shape.rotation));
    points.push(...letter);
    if (i < text.length - 1) {
      points.push(letter[letter.length - 1]);
    }
  }

  return points;
}

function interpolatePath(points: { x: number; y: number }[], spacing: number): StitchPoint[] {
  const stitches: StitchPoint[] = [];
  if (points.length === 0) {
    return stitches;
  }

  let current = points[0];
  stitches.push({ x: current.x, y: current.y, command: STITCH_COMMAND.STITCH });

  for (let i = 1; i < points.length; i++) {
    const target = points[i];
    let dx = target.x - current.x;
    let dy = target.y - current.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      continue;
    }
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      stitches.push({
        x: current.x + dx * t,
        y: current.y + dy * t,
        command: STITCH_COMMAND.STITCH,
      });
    }
    current = target;
  }

  return stitches;
}

function generateFill(shape: DesignShape): StitchPoint[] {
  const compW = shape.pullCompensation ? shape.pullCompensation * 10 * 2 : 0;
  const compH = shape.pullCompensation ? shape.pullCompensation * 10 * 2 : 0;
  const w = shape.width + compW;
  const h = shape.height + compH;
  
  const left = shape.x - w / 2;
  const top = shape.y - h / 2;
  const bottom = shape.y + h / 2;
  const stitches: StitchPoint[] = [];
  let reverse = false;

  const lineSpacing = shape.density ? shape.density * 10 : FILL_LINE_SPACING;

  if (shape.underlay) {
    const underlaySpacing = lineSpacing * 6;
    for (let y = top; y <= bottom; y += underlaySpacing) {
      const p1 = rotatePoint(left, y, shape.x, shape.y, shape.rotation);
      const p2 = rotatePoint(left + w, y, shape.x, shape.y, shape.rotation);
      const line = reverse ? [p2, p1] : [p1, p2];
      stitches.push(...interpolatePath(line, STITCH_SPACING * 1.5));
      reverse = !reverse;
    }
  }

  for (let y = top; y <= bottom; y += lineSpacing) {
    const p1 = rotatePoint(left, y, shape.x, shape.y, shape.rotation);
    const p2 = rotatePoint(left + w, y, shape.x, shape.y, shape.rotation);
    const line = reverse ? [p2, p1] : [p1, p2];
    stitches.push(...interpolatePath(line, STITCH_SPACING));
    reverse = !reverse;
  }

  return stitches;
}

function generateSatin(shape: DesignShape): StitchPoint[] {
  const compW = shape.pullCompensation ? shape.pullCompensation * 10 * 2 : 0;
  const compH = shape.pullCompensation ? shape.pullCompensation * 10 * 2 : 0;
  const w = shape.width + compW;
  const h = shape.height + compH;

  const left = shape.x - w / 2;
  const top = shape.y - h / 2;
  const bottom = shape.y + h / 2;
  const stitches: StitchPoint[] = [];
  let reverse = false;
  
  const lineSpacing = shape.density ? shape.density * 10 : STITCH_SPACING;

  if (shape.underlay) {
    const p1 = rotatePoint(shape.x, top, shape.x, shape.y, shape.rotation);
    const p2 = rotatePoint(shape.x, bottom, shape.x, shape.y, shape.rotation);
    stitches.push(...interpolatePath([p1, p2], STITCH_SPACING * 1.5));
    stitches.push(...interpolatePath([p2, p1], STITCH_SPACING * 1.5));
  }

  for (let y = top; y <= bottom; y += lineSpacing) {
    const p1 = rotatePoint(left, y, shape.x, shape.y, shape.rotation);
    const p2 = rotatePoint(left + w, y, shape.x, shape.y, shape.rotation);
    const line = reverse ? [p2, p1] : [p1, p2];
    stitches.push({ x: line[0].x, y: line[0].y, command: STITCH_COMMAND.STITCH });
    stitches.push({ x: line[1].x, y: line[1].y, command: STITCH_COMMAND.STITCH });
    reverse = !reverse;
  }

  return stitches;
}

function generateRunning(shape: DesignShape): StitchPoint[] {
  let path: { x: number; y: number }[] = [];
  switch (shape.type) {
    case 'rect':
      path = rectPoints(shape);
      break;
    case 'ellipse':
      path = ellipsePoints(shape);
      break;
    case 'line':
      path = linePoints(shape);
      break;
    case 'text':
      path = textPoints(shape);
      break;
  }
  return interpolatePath(path, STITCH_SPACING);
}

function generateStitchPath(shape: DesignShape): StitchPoint[] {
  const points = shape.points ?? [];
  if (points.length === 0) {
    return [];
  }
  const jumps = new Set(shape.jumps ?? []);
  return points.map((point, index) => ({
    x: shape.x + point.x,
    y: shape.y + point.y,
    command: jumps.has(index) ? STITCH_COMMAND.JUMP : STITCH_COMMAND.STITCH,
  }));
}

function generateTextStitches(shape: DesignShape): StitchPoint[] {
  const text = shape.text || '';
  if (!text) return [];

  // Fallback if document or canvas is not available (e.g. Server Side Rendering)
  if (typeof document === 'undefined') {
    return interpolatePath(textPoints(shape), STITCH_SPACING);
  }

  try {
    const canvas = document.createElement('canvas');
    // Resolution scale: 1 unit of design space = 1 pixel.
    const width = Math.max(10, Math.round(shape.width));
    const height = Math.max(10, Math.round(shape.height));
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return interpolatePath(textPoints(shape), STITCH_SPACING);
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000000';
    const fontName = shape.fontFamily || 'Arial';
    ctx.font = `bold ${height * 0.85}px "${fontName}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // cellSpacing controls density. 4 units = 0.4mm cell.
    const cellSpacing = 4;
    const gridW = Math.ceil(width / cellSpacing);
    const gridH = Math.ceil(height / cellSpacing);

    const grid: number[][] = Array.from({ length: gridH }, () => Array(gridW).fill(-1));
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        let darkCount = 0;
        let total = 0;
        const startY = gy * cellSpacing;
        const startX = gx * cellSpacing;

        for (let y = startY; y < Math.min(startY + cellSpacing, height); y++) {
          for (let x = startX; x < Math.min(startX + cellSpacing, width); x++) {
            total++;
            const idx = (y * width + x) * 4;
            // Black pixels will have low values
            if (data[idx] < 127 && data[idx + 1] < 127 && data[idx + 2] < 127) {
              darkCount++;
            }
          }
        }
        if (total > 0 && darkCount / total > 0.3) {
          grid[gy][gx] = 0; // filled
        }
      }
    }

    if (shape.stitchType === 'running') {
      const components = findConnectedComponents(grid, gridW, gridH, 0);
      const stitches: StitchPoint[] = [];

      for (let i = 0; i < components.length; i++) {
        const compGrid = components[i];
        const boundaryGridPixels = traceMooreNeighborhood(compGrid, gridW, gridH, 0);
        if (boundaryGridPixels.length > 3) {
          const smoothedGrid = smoothContour(boundaryGridPixels, 2);
          const originX = -shape.width / 2;
          const originY = -shape.height / 2;
          const unitPerCellX = shape.width / gridW;
          const unitPerCellY = shape.height / gridH;
          const boundaryPoints = smoothedGrid.map((p) => ({
            x: originX + (p.x + 0.5) * unitPerCellX,
            y: originY + (p.y + 0.5) * unitPerCellY,
          }));
          boundaryPoints.push({ ...boundaryPoints[0] });

          const resampledBoundary = resamplePath(boundaryPoints, 20); // 2mm stitches
          if (resampledBoundary.length > 2) {
            for (let idx = 0; idx < resampledBoundary.length; idx++) {
              const pt = resampledBoundary[idx];
              stitches.push({
                x: shape.x + pt.x,
                y: shape.y + pt.y,
                command: idx === 0 && stitches.length > 0 ? STITCH_COMMAND.JUMP : STITCH_COMMAND.STITCH,
              });
            }
          }
        }
      }

      return stitches.map((s) => {
        const p = rotatePoint(s.x, s.y, shape.x, shape.y, shape.rotation);
        return { x: p.x, y: p.y, command: s.command };
      });
    } else {
      // Default to tatami fill (for fill or satin text)
      const { points, jumps } = generateFillStitchesFromMask(
        grid,
        gridW,
        gridH,
        0,
        shape.width,
        shape.height,
        7 // detail level
      );

      const jumpSet = new Set(jumps);
      const shapeStitches = points.map((p, idx) => ({
        x: shape.x + p.x,
        y: shape.y + p.y,
        command: jumpSet.has(idx) ? STITCH_COMMAND.JUMP : STITCH_COMMAND.STITCH,
      }));

      return shapeStitches.map((s) => {
        const p = rotatePoint(s.x, s.y, shape.x, shape.y, shape.rotation);
        return { x: p.x, y: p.y, command: s.command };
      });
    }
  } catch (e) {
    // Fallback if any error occurs during canvas operations
    return interpolatePath(textPoints(shape), STITCH_SPACING);
  }
}

function generateShapeStitches(shape: DesignShape): StitchPoint[] {
  if (shape.type === 'stitchpath') {
    return generateStitchPath(shape);
  }
  if (shape.type === 'text') {
    return generateTextStitches(shape);
  }
  switch (shape.stitchType) {
    case 'fill':
      return generateFill(shape);
    case 'satin':
      return generateSatin(shape);
    default:
      return generateRunning(shape);
  }
}

function splitLongMoves(stitches: StitchPoint[], maxDistance = 120): StitchPoint[] {
  if (stitches.length === 0) return [];
  const result: StitchPoint[] = [stitches[0]];
  let lastX = stitches[0].x;
  let lastY = stitches[0].y;

  for (let i = 1; i < stitches.length; i++) {
    const stitch = stitches[i];
    let dx = stitch.x - lastX;
    let dy = stitch.y - lastY;
    const distance = Math.hypot(dx, dy);

    if (distance > maxDistance && (stitch.command & COMMAND_MASK) === STITCH_COMMAND.STITCH) {
      const steps = Math.ceil(distance / maxDistance);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        result.push({
          x: lastX + dx * t,
          y: lastY + dy * t,
          command: STITCH_COMMAND.STITCH,
        });
      }
    } else {
      result.push(stitch);
    }

    lastX = stitch.x;
    lastY = stitch.y;
  }

  return result;
}

export function generatePatternStitches(design: EmbroideryDesign): StitchPoint[] {
  const colorMap = new Map<string, ThreadColor>(design.colors.map((c) => [c.id, c]));
  const grouped = new Map<string, DesignShape[]>();

  for (const shape of design.shapes) {
    const list = grouped.get(shape.colorId) ?? [];
    list.push(shape);
    grouped.set(shape.colorId, list);
  }

  const stitches: StitchPoint[] = [];
  let firstColor = true;

  for (const color of design.colors) {
    const shapes = grouped.get(color.id);
    if (!shapes?.length) {
      continue;
    }

    if (!firstColor) {
      stitches.push({ x: stitches.at(-1)?.x ?? 0, y: stitches.at(-1)?.y ?? 0, command: STITCH_COMMAND.COLOR_CHANGE });
    }
    firstColor = false;

    for (const shape of shapes) {
      const shapeStitches = splitLongMoves(generateShapeStitches(shape));
      if (shapeStitches.length === 0) {
        continue;
      }

      const first = shapeStitches[0];
      const last = stitches.at(-1);
      if (last && (Math.abs(last.x - first.x) > 1 || Math.abs(last.y - first.y) > 1)) {
        stitches.push({ x: first.x, y: first.y, command: STITCH_COMMAND.JUMP });
      }

      stitches.push(...shapeStitches);
    }

    if (!colorMap.has(color.id)) {
      continue;
    }
  }

  if (stitches.length > 0) {
    const last = stitches.at(-1)!;
    stitches.push({ x: last.x, y: last.y, command: STITCH_COMMAND.END });
  }

  return stitches;
}

export function countColorChanges(stitches: StitchPoint[]): number {
  return stitches.filter((s) => (s.command & COMMAND_MASK) === STITCH_COMMAND.COLOR_CHANGE).length + 1;
}

export function countDesignStitches(design: EmbroideryDesign): number {
  const stitches = generatePatternStitches(design);
  return stitches.filter((s) => (s.command & COMMAND_MASK) === STITCH_COMMAND.STITCH).length;
}
