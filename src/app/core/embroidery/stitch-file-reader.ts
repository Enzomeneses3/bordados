import { findNearestJefIndex } from '../constants/jef-colors';
import {
  COMMAND_MASK,
  DesignShape,
  EmbroideryDesign,
  ImageTraceResult,
  STITCH_COMMAND,
  StitchPoint,
  ThreadColor,
} from '../../models/embroidery.model';

function createId(): string {
  return crypto.randomUUID();
}

function bit(value: number, n: number): number {
  return (value >> n) & 1;
}

function signedByte(value: number): number {
  return value > 127 ? value - 256 : value;
}

export function readDstStitches(bytes: Uint8Array, startOffset = 512): StitchPoint[] {
  const slice = bytes.subarray(startOffset);
  const buffer = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
  return readDst(buffer);
}

export function readPesStitches(buffer: ArrayBuffer, pecOffset?: number): StitchPoint[] {
  const bytes = new Uint8Array(buffer);
  const offset = pecOffset ?? findPecOffset(bytes);
  return readPec(bytes, offset).stitches;
}

function readDst(buffer: ArrayBuffer): StitchPoint[] {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 512) {
    throw new Error('Archivo DST inválido (encabezado incompleto)');
  }

  const stitches: StitchPoint[] = [];
  let x = 0;
  let y = 0;

  for (let offset = 512; offset + 2 < bytes.length; offset += 3) {
    const b0 = bytes[offset];
    const b1 = bytes[offset + 1];
    const b2 = bytes[offset + 2];

    if (b2 === 0xf3) {
      stitches.push({ x, y, command: STITCH_COMMAND.END });
      break;
    }

    if (b2 === 0xc3) {
      stitches.push({ x, y, command: STITCH_COMMAND.COLOR_CHANGE });
      continue;
    }

    const jump = (b2 & 0x80) !== 0;
    let dx = 0;
    let dy = 0;

    dx += bit(b2, 2) * 81;
    dx -= bit(b2, 3) * 81;
    dx += bit(b1, 2) * 27;
    dx -= bit(b1, 3) * 27;
    dx += bit(b0, 2) * 9;
    dx -= bit(b0, 3) * 9;
    dx += bit(b1, 0) * 3;
    dx -= bit(b1, 1) * 3;
    dx += bit(b0, 0) * 1;
    dx -= bit(b0, 1) * 1;

    dy += bit(b2, 5) * 81;
    dy -= bit(b2, 4) * 81;
    dy += bit(b1, 5) * 27;
    dy -= bit(b1, 4) * 27;
    dy += bit(b0, 5) * 9;
    dy -= bit(b0, 4) * 9;
    dy += bit(b1, 7) * 3;
    dy -= bit(b1, 6) * 3;
    dy += bit(b0, 7) * 1;
    dy -= bit(b0, 6) * 1;

    x += dx;
    y -= dy;

    stitches.push({
      x,
      y,
      command: jump ? STITCH_COMMAND.JUMP : STITCH_COMMAND.STITCH,
    });
  }

  return stitches;
}

function findPecOffset(bytes: Uint8Array): number {
  const text = new TextDecoder('ascii').decode(bytes.slice(0, Math.min(bytes.length, 1024)));
  const match = text.match(/^#PES(\d{4})/);
  if (!match) {
    throw new Error('Archivo PES inválido (firma no encontrada)');
  }
  return bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
}

function readPec(bytes: Uint8Array, pecOffset: number): { stitches: StitchPoint[]; threadIndexes: number[] } {
  if (pecOffset <= 0 || pecOffset >= bytes.length) {
    throw new Error('Archivo PES inválido (offset PEC fuera de rango)');
  }

  let cursor = pecOffset + 0x30 + 16;
  if (cursor >= bytes.length) {
    throw new Error('Archivo PES inválido (PEC truncado)');
  }

  const colorCount = bytes[cursor++] + 1;
  const threadIndexes: number[] = [];
  for (let i = 0; i < colorCount && cursor < bytes.length; i++) {
    threadIndexes.push(bytes[cursor++]);
  }

  cursor = pecOffset + 0x30 + 16 + 1 + 462;
  if (cursor + 5 >= bytes.length) {
    throw new Error('Archivo PES inválido (datos de puntada incompletos)');
  }

  cursor += 5;
  const stitches: StitchPoint[] = [];
  let x = 0;
  let y = 0;

  while (cursor < bytes.length - 1) {
    const val1 = bytes[cursor++];
    const val2 = bytes[cursor++];

    if (val1 === 0xff && val2 === 0x00) {
      stitches.push({ x, y, command: STITCH_COMMAND.END });
      break;
    }

    if (val1 === 0xfe && val2 === 0xb0) {
      if (cursor < bytes.length) {
        cursor++;
      }
      stitches.push({ x, y, command: STITCH_COMMAND.COLOR_CHANGE });
      continue;
    }

    let dx: number;
    let dy: number;
    let jump = false;

    if ((val1 & 0x80) !== 0) {
      jump = (val1 & 0x20) !== 0;
      let raw = ((val1 & 0x0f) << 8) | val2;
      if (raw & 0x800) {
        raw -= 0x1000;
      }
      dx = raw;

      if (cursor >= bytes.length) {
        break;
      }
      const val3 = bytes[cursor++];
      if ((val3 & 0x80) !== 0) {
        const val4 = bytes[cursor++] ?? 0;
        let rawY = ((val3 & 0x0f) << 8) | val4;
        if (rawY & 0x800) {
          rawY -= 0x1000;
        }
        dy = rawY;
      } else {
        dy = val3 > 63 ? val3 - 128 : val3;
      }
    } else {
      dx = val1 > 63 ? val1 - 128 : val1;
      if ((val2 & 0x80) !== 0) {
        const val3 = bytes[cursor++] ?? 0;
        let rawY = ((val2 & 0x0f) << 8) | val3;
        if (rawY & 0x800) {
          rawY -= 0x1000;
        }
        dy = rawY;
      } else {
        dy = val2 > 63 ? val2 - 128 : val2;
      }
    }

    x += dx;
    y += dy;
    stitches.push({
      x,
      y,
      command: jump ? STITCH_COMMAND.JUMP : STITCH_COMMAND.STITCH,
    });
  }

  return { stitches, threadIndexes };
}

function readPes(buffer: ArrayBuffer): { stitches: StitchPoint[]; threadIndexes: number[] } {
  const bytes = new Uint8Array(buffer);
  const offset = findPecOffset(bytes);
  return readPec(bytes, offset);
}

function isEmbFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8) {
    return false;
  }
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return magic.every((value, index) => bytes[index] === value);
}

const PALETTE_PRESET: string[] = [
  '#000000', '#1a1a1a', '#ffffff', '#ff0000', '#00a651', '#0066b3',
  '#fff200', '#ff7f00', '#9b5de5', '#f15bb5', '#00bbf9', '#00f5d4',
  '#8d99ae', '#6a994e', '#bc4749', '#386641', '#bc6c25', '#283618',
];

function colorForIndex(index: number): string {
  return PALETTE_PRESET[index % PALETTE_PRESET.length];
}

function chunkByColor(stitches: StitchPoint[]): StitchPoint[][] {
  const chunks: StitchPoint[][] = [];
  let current: StitchPoint[] = [];

  for (const stitch of stitches) {
    const command = stitch.command & COMMAND_MASK;
    if (command === STITCH_COMMAND.END) {
      if (current.length) {
        chunks.push(current);
      }
      break;
    }
    if (command === STITCH_COMMAND.COLOR_CHANGE) {
      if (current.length) {
        chunks.push(current);
      }
      current = [];
      continue;
    }
    current.push(stitch);
  }

  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

export function buildImportResult(
  name: string,
  stitches: StitchPoint[],
  paletteHints: string[] | undefined,
): ImageTraceResult {
  if (stitches.length === 0) {
    throw new Error('El archivo no contiene puntadas');
  }

  const chunks = chunkByColor(stitches);
  const colors: ThreadColor[] = chunks.map((_, index) => {
    const hex = paletteHints?.[index] ?? colorForIndex(index);
    return {
      id: createId(),
      name: `Hilo ${index + 1}`,
      hex,
      jefIndex: findNearestJefIndex(hex),
    };
  });

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
    minX = minY = maxX = maxY = 0;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const shapes: DesignShape[] = chunks.map((chunk, index) => {
    const points: { x: number; y: number }[] = [];
    const jumps: number[] = [];
    chunk.forEach((stitch, pointIndex) => {
      points.push({ x: stitch.x - centerX, y: stitch.y - centerY });
      if ((stitch.command & COMMAND_MASK) === STITCH_COMMAND.JUMP) {
        jumps.push(pointIndex);
      }
    });
    return {
      id: createId(),
      type: 'stitchpath',
      x: 0,
      y: 0,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      rotation: 0,
      colorId: colors[index].id,
      stitchType: 'running',
      label: `Bloque ${index + 1}`,
      source: 'import',
      points,
      jumps,
    };
  });

  return {
    name,
    colors,
    shapes,
    backgroundImage: null,
  };
}

export async function readStitchFile(file: File): Promise<ImageTraceResult> {
  const buffer = await file.arrayBuffer();
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.dst')) {
    const stitches = readDst(buffer);
    return buildImportResult(file.name.replace(/\.[^.]+$/, ''), stitches, undefined);
  }

  if (lowerName.endsWith('.pes') || lowerName.endsWith('.pec')) {
    const { stitches } = readPes(buffer);
    return buildImportResult(file.name.replace(/\.[^.]+$/, ''), stitches, undefined);
  }

  if (lowerName.endsWith('.emb') || lowerName.endsWith('.art')) {
    if (!isEmbFile(buffer)) {
      throw new Error('Archivo EMB/ART inválido');
    }
    const { readEmb } = await import('./emb-file-reader');
    return readEmb(buffer, file.name);
  }

  throw new Error('Formato de archivo no soportado');
}

export function isStitchFileName(fileName: string): boolean {
  return /\.(dst|pes|pec|emb|art)$/i.test(fileName);
}

export function applyStitchImport(
  design: EmbroideryDesign,
  result: ImageTraceResult,
): EmbroideryDesign {
  return {
    ...design,
    name: result.name || design.name,
    colors: result.colors,
    shapes: result.shapes,
    backgroundImage: null,
  };
}
