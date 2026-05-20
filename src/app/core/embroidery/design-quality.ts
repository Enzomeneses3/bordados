import { DesignShape, EmbroideryDesign, ImageTraceOptions, ThreadColor } from '../../models/embroidery.model';

function cloneShapes(shapes: DesignShape[]): DesignShape[] {
  return JSON.parse(JSON.stringify(shapes)) as DesignShape[];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized.padStart(6, '0').slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function hexDistance(a: string, b: string): number {
  const c1 = hexToRgb(a);
  const c2 = hexToRgb(b);
  return (c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2;
}

function detailToStep(detail: number): number {
  const clamped = Math.min(10, Math.max(1, detail));
  return Math.max(1, Math.round((11 - clamped) * 0.85));
}

function decimateStitchPath(shape: DesignShape, step: number): DesignShape {
  if (shape.type !== 'stitchpath' || !shape.points?.length || step <= 1) {
    return shape;
  }

  const points = shape.points;
  const oldJumps = new Set(shape.jumps ?? []);
  const newPoints: { x: number; y: number }[] = [];
  const newJumps: number[] = [];

  for (let i = 0; i < points.length; i++) {
    const keep = i === 0 || i === points.length - 1 || i % step === 0 || oldJumps.has(i);
    if (!keep) {
      continue;
    }
    if (oldJumps.has(i) && newPoints.length > 0) {
      newJumps.push(newPoints.length);
    }
    newPoints.push(points[i]);
  }

  if (newPoints.length < 2) {
    return shape;
  }

  return { ...shape, points: newPoints, jumps: newJumps };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

function shapeCentroid(shape: DesignShape): { x: number; y: number } {
  if (shape.type === 'stitchpath' && shape.points?.length) {
    let sx = 0;
    let sy = 0;
    for (const p of shape.points) {
      sx += shape.x + p.x;
      sy += shape.y + p.y;
    }
    return { x: sx / shape.points.length, y: sy / shape.points.length };
  }
  return { x: shape.x, y: shape.y };
}

function variantThreadColor(base: ThreadColor, variantIndex: number, total: number): ThreadColor {
  const rgb = hexToRgb(base.hex);
  const t = total <= 1 ? 0.5 : variantIndex / (total - 1);
  const factor = 0.55 + t * 0.9;
  return {
    ...base,
    id: crypto.randomUUID(),
    name: `${base.name} ${variantIndex + 1}`,
    hex: rgbToHex(rgb.r * factor, rgb.g * factor, rgb.b * factor),
    jefIndex: base.jefIndex,
  };
}

function buildRemap(palette: ThreadColor[], kept: ThreadColor[]): Map<string, string> {
  const remap = new Map<string, string>();
  for (const color of palette) {
    const direct = kept.find((k) => k.id === color.id);
    if (direct) {
      remap.set(color.id, direct.id);
      continue;
    }
    let nearest = kept[0];
    let best = Infinity;
    for (const candidate of kept) {
      const dist = hexDistance(color.hex, candidate.hex);
      if (dist < best) {
        best = dist;
        nearest = candidate;
      }
    }
    remap.set(color.id, nearest.id);
  }
  return remap;
}

/** Une colores cuando maxColors es menor que los grupos actuales. */
function mergeThreadColors(
  shapes: DesignShape[],
  palette: ThreadColor[],
  maxColors: number,
): { shapes: DesignShape[]; colors: ThreadColor[] } {
  const usage = new Map<string, number>();
  for (const shape of shapes) {
    usage.set(shape.colorId, (usage.get(shape.colorId) ?? 0) + 1);
  }

  const usedPalette = palette.filter((c) => usage.has(c.id));
  const sorted = [...usedPalette].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0));
  const kept = sorted.slice(0, maxColors);
  const remap = buildRemap(palette, kept);

  return {
    shapes: shapes.map((shape) => ({
      ...shape,
      colorId: remap.get(shape.colorId) ?? shape.colorId,
    })),
    colors: kept,
  };
}

/**
 * Reparte grupos grandes en más colores cuando maxColors supera los hilos del archivo.
 */
function expandThreadColors(
  shapes: DesignShape[],
  palette: ThreadColor[],
  maxColors: number,
): { shapes: DesignShape[]; colors: ThreadColor[] } {
  type ColorGroup = { color: ThreadColor; shapeIndices: number[] };

  const groups = new Map<string, ColorGroup>();
  shapes.forEach((shape, index) => {
    const existing = groups.get(shape.colorId);
    if (existing) {
      existing.shapeIndices.push(index);
    } else {
      const color = palette.find((c) => c.id === shape.colorId);
      if (color) {
        groups.set(shape.colorId, { color, shapeIndices: [index] });
      }
    }
  });

  let groupList = [...groups.values()];

  while (groupList.length < maxColors) {
    groupList.sort((a, b) => b.shapeIndices.length - a.shapeIndices.length);
    const largest = groupList[0];
    if (largest.shapeIndices.length < 2) {
      break;
    }

    const centroids = largest.shapeIndices.map((i) => ({
      index: i,
      ...shapeCentroid(shapes[i]),
    }));
    centroids.sort((a, b) => a.x - b.x);
    const mid = Math.floor(centroids.length / 2);
    const leftIndices = new Set(centroids.slice(0, mid).map((c) => c.index));
    const rightIndices = largest.shapeIndices.filter((i) => !leftIndices.has(i));

    if (rightIndices.length === 0 || leftIndices.size === 0) {
      break;
    }

    const newColor = variantThreadColor(largest.color, 1, 2);
    const leftGroup: ColorGroup = { color: largest.color, shapeIndices: [...leftIndices] };
    const rightGroup: ColorGroup = { color: newColor, shapeIndices: rightIndices };

    groupList = [leftGroup, rightGroup, ...groupList.slice(1)];
  }

  const finalGroups = groupList.slice(0, maxColors);
  const resultShapes = shapes.map((s) => ({ ...s }));
  const resultColors: ThreadColor[] = [];

  for (const group of finalGroups) {
    resultColors.push(group.color);
    for (const idx of group.shapeIndices) {
      resultShapes[idx] = { ...resultShapes[idx], colorId: group.color.id };
    }
  }

  return { shapes: resultShapes, colors: resultColors };
}

function applyThreadColorLimit(
  shapes: DesignShape[],
  sourcePalette: ThreadColor[],
  maxColors: number,
): { shapes: DesignShape[]; colors: ThreadColor[] } {
  const clamped = Math.min(15, Math.max(2, maxColors));
  const usedIds = new Set(shapes.map((s) => s.colorId));
  const palette = sourcePalette.filter((c) => usedIds.has(c.id));
  const uniqueInShapes = palette.length;

  if (uniqueInShapes === 0) {
    return { shapes, colors: sourcePalette.slice(0, clamped) };
  }

  if (clamped < uniqueInShapes) {
    return mergeThreadColors(shapes, palette, clamped);
  }

  if (clamped > uniqueInShapes) {
    return expandThreadColors(shapes, palette, clamped);
  }

  return { shapes, colors: palette };
}

/** Aplica calidad (menos puntadas / menos hilos) desde una copia fuente sin perder calidad máxima. */
export function applyQualityToDesign(
  design: EmbroideryDesign,
  sourceShapes: DesignShape[],
  sourcePalette: ThreadColor[],
  options: ImageTraceOptions,
): EmbroideryDesign {
  const step = detailToStep(options.detail);
  let shapes = cloneShapes(sourceShapes).map((shape) => decimateStitchPath(shape, step));

  const palette = sourcePalette.length > 0 ? sourcePalette : design.colors;
  const colored = applyThreadColorLimit(shapes, palette, options.maxColors);
  shapes = colored.shapes;

  return {
    ...design,
    shapes,
    colors: colored.colors,
  };
}

export function estimateQualityStitches(shapes: DesignShape[]): number {
  let total = 0;
  for (const shape of shapes) {
    if (shape.type === 'stitchpath' && shape.points) {
      total += Math.max(0, shape.points.length - 1);
    } else {
      total += 12;
    }
  }
  return total;
}
