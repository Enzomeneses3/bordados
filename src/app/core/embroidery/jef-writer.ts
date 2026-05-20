import { findNearestJefIndex } from '../constants/jef-colors';
import { COMMAND_MASK, STITCH_COMMAND, StitchPoint, ThreadColor } from '../../models/embroidery.model';

const HOOP_110X110 = 0;
const HOOP_50X50 = 1;
const HOOP_140X200 = 2;
const HOOP_126X110 = 3;
const HOOP_200X200 = 4;

function writeInt8(view: DataView, offset: number, value: number): number {
  view.setInt8(offset, value);
  return offset + 1;
}

function writeInt32Le(view: DataView, offset: number, value: number): number {
  view.setInt32(offset, value, true);
  return offset + 4;
}

function writeString(view: DataView, offset: number, value: string, length: number): number {
  for (let i = 0; i < length; i++) {
    view.setUint8(offset + i, i < value.length ? value.charCodeAt(i) : 0);
  }
  return offset + length;
}

function getBounds(stitches: StitchPoint[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stitch of stitches) {
    if ((stitch.command & COMMAND_MASK) === STITCH_COMMAND.END) {
      continue;
    }
    minX = Math.min(minX, stitch.x);
    minY = Math.min(minY, stitch.y);
    maxX = Math.max(maxX, stitch.x);
    maxY = Math.max(maxY, stitch.y);
  }

  if (!Number.isFinite(minX)) {
    return [0, 0, 0, 0];
  }

  return [minX, minY, maxX, maxY];
}

function getJefHoopSize(width: number, height: number): number {
  if (width < 500 && height < 500) {
    return HOOP_50X50;
  }
  if (width < 1260 && height < 1100) {
    return HOOP_126X110;
  }
  if (width < 1400 && height < 2000) {
    return HOOP_140X200;
  }
  if (width < 2000 && height < 2000) {
    return HOOP_200X200;
  }
  return HOOP_110X110;
}

function writeHoopEdgeDistance(view: DataView, offset: number, xEdge: number, yEdge: number): number {
  if (Math.min(xEdge, yEdge) >= 0) {
    offset = writeInt32Le(view, offset, xEdge);
    offset = writeInt32Le(view, offset, yEdge);
    offset = writeInt32Le(view, offset, xEdge);
    offset = writeInt32Le(view, offset, yEdge);
  } else {
    for (let i = 0; i < 4; i++) {
      offset = writeInt32Le(view, offset, -1);
    }
  }
  return offset;
}

function buildPalette(stitches: StitchPoint[], colors: ThreadColor[]): number[] {
  const palette: number[] = [];
  const usedIndices = new Set<number>();
  let currentIndex = colors[0] ? findNearestJefIndex(colors[0].hex) : 1;
  palette.push(currentIndex);
  usedIndices.add(currentIndex);

  for (const stitch of stitches) {
    if ((stitch.command & COMMAND_MASK) !== STITCH_COMMAND.COLOR_CHANGE) {
      continue;
    }
    const colorIdx = palette.length;
    const color = colors[colorIdx] ?? colors[colors.length - 1];
    let jefIndex = findNearestJefIndex(color.hex);
    if (usedIndices.has(jefIndex)) {
      jefIndex = (jefIndex % 30) + 1;
    }
    palette.push(jefIndex);
    usedIndices.add(jefIndex);
    currentIndex = jefIndex;
  }

  return palette.length ? palette : [currentIndex];
}

function countJefPoints(stitches: StitchPoint[]): number {
  let pointCount = 1;
  for (const stitch of stitches) {
    const command = stitch.command & COMMAND_MASK;
    if (command === STITCH_COMMAND.STITCH) {
      pointCount += 1;
    } else if (command === STITCH_COMMAND.JUMP) {
      pointCount += 2;
    } else if (command === STITCH_COMMAND.COLOR_CHANGE || command === STITCH_COMMAND.STOP) {
      pointCount += 2;
    } else if (command === STITCH_COMMAND.END) {
      break;
    }
  }
  return pointCount;
}

export function writeJefFile(stitches: StitchPoint[], colors: ThreadColor[], designName: string): Blob {
  const palette = buildPalette(stitches, colors);
  const colorCount = palette.length;
  const headerSize = 0x74 + colorCount * 8;
  const bodyEstimate = stitches.length * 4 + 16;
  const buffer = new ArrayBuffer(headerSize + bodyEstimate);
  const view = new DataView(buffer);
  let offset = 0;

  const dateString = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const bounds = getBounds(stitches);
  const designWidth = Math.round(bounds[2] - bounds[0]);
  const designHeight = Math.round(bounds[3] - bounds[1]);
  const halfWidth = Math.round(designWidth / 2);
  const halfHeight = Math.round(designHeight / 2);

  offset = writeInt32Le(view, offset, headerSize);
  offset = writeInt32Le(view, offset, 0x14);
  offset = writeString(view, offset, dateString, 14);
  offset = writeInt8(view, offset, 0);
  offset = writeInt8(view, offset, 0);
  offset = writeInt32Le(view, offset, colorCount);
  offset = writeInt32Le(view, offset, countJefPoints(stitches));
  offset = writeInt32Le(view, offset, getJefHoopSize(designWidth, designHeight));

  offset = writeInt32Le(view, offset, halfWidth);
  offset = writeInt32Le(view, offset, halfHeight);
  offset = writeInt32Le(view, offset, halfWidth);
  offset = writeInt32Le(view, offset, halfHeight);

  offset = writeHoopEdgeDistance(view, offset, 550 - halfWidth, 550 - halfHeight);
  offset = writeHoopEdgeDistance(view, offset, 250 - halfWidth, 250 - halfHeight);
  offset = writeHoopEdgeDistance(view, offset, 700 - halfWidth, 1000 - halfHeight);
  offset = writeHoopEdgeDistance(view, offset, 700 - halfWidth, 1000 - halfHeight);

  for (const colorIndex of palette) {
    offset = writeInt32Le(view, offset, colorIndex);
  }
  for (let i = 0; i < colorCount; i++) {
    offset = writeInt32Le(view, offset, 0x0d);
  }

  let xx = 0;
  let yy = 0;
  for (const stitch of stitches) {
    const command = stitch.command & COMMAND_MASK;
    const dx = Math.round(stitch.x - xx);
    const dy = Math.round(stitch.y - yy);
    xx += dx;
    yy += dy;

    if (command === STITCH_COMMAND.STITCH) {
      offset = writeInt8(view, offset, dx);
      offset = writeInt8(view, offset, -dy);
    } else if (command === STITCH_COMMAND.COLOR_CHANGE || command === STITCH_COMMAND.STOP) {
      view.setUint8(offset++, 0x80);
      view.setUint8(offset++, 0x01);
      offset = writeInt8(view, offset, dx);
      offset = writeInt8(view, offset, -dy);
    } else if (command === STITCH_COMMAND.JUMP) {
      view.setUint8(offset++, 0x80);
      view.setUint8(offset++, 0x02);
      offset = writeInt8(view, offset, dx);
      offset = writeInt8(view, offset, -dy);
    } else if (command === STITCH_COMMAND.END) {
      break;
    }
  }

  view.setUint8(offset++, 0x80);
  view.setUint8(offset++, 0x10);

  return new Blob([buffer.slice(0, offset)], { type: 'application/octet-stream' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
