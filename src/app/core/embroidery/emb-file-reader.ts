import * as CFB from 'cfb';
import { inflateSync } from 'fflate';
import { ImageTraceResult, StitchPoint } from '../../models/embroidery.model';
import { expandEmbCompress } from './emb-compress';
import { buildImportResult, readDstStitches, readPesStitches } from './stitch-file-reader';

function isOleCompoundFile(bytes: Uint8Array): boolean {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return magic.every((value, index) => bytes[index] === value);
}

function artSwizzle(byte: number): number {
  let b = byte ^ 0xd2;
  b = ((b << 1) | (b >> 7)) & 0xff;
  return b;
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function tryZlibInflate(data: Uint8Array, skipHeader = true): Uint8Array | null {
  const payloads: Uint8Array[] = [];
  if (skipHeader && data.length > 8) {
    payloads.push(data.subarray(4));
  }
  payloads.push(data);

  for (const payload of payloads) {
    try {
      return inflateSync(payload);
    } catch {
      // try next
    }
    if (payload.length > 6 && payload[2] === 0x78) {
      try {
        return inflateSync(payload.subarray(2));
      } catch {
        // continue
      }
    }
  }
  return null;
}

function tryEmbCompress(data: Uint8Array): Uint8Array | null {
  const attempts: Uint8Array[] = [data];
  if (data.length > 4) {
    const size = readUint32Le(data, 0);
    if (size > 0 && size < 50_000_000) {
      attempts.push(data.subarray(4));
      try {
        return expandEmbCompress(data.subarray(4), size);
      } catch {
        // continue
      }
    }
  }
  for (const chunk of attempts) {
    try {
      const declaredSize = chunk.length > 4 ? readUint32Le(chunk, 0) : 0;
      const body = chunk.length > 4 ? chunk.subarray(4) : chunk;
      const out = expandEmbCompress(
        body,
        declaredSize > 0 && declaredSize < 50_000_000 ? declaredSize : undefined,
      );
      if (out.length > 16) {
        return out;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function decompressStreamPayload(data: Uint8Array, swizzle = false): Uint8Array[] {
  const raw = swizzle ? Uint8Array.from(data, artSwizzle) : data;
  const results: Uint8Array[] = [];

  const zlibOut = tryZlibInflate(raw, true);
  if (zlibOut && zlibOut.length > 0) {
    results.push(zlibOut);
  }

  const embOut = tryEmbCompress(raw);
  if (embOut && embOut.length > 0) {
    results.push(embOut);
  }

  if (!swizzle) {
    results.push(raw);
  }

  return results;
}

function findLaHeaderOffset(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const match = text.match(/LA:\s*/);
  if (!match || match.index === undefined) {
    return -1;
  }
  return match.index;
}

function findPesOffset(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 2048)));
  const match = text.match(/#PES\d{4}/);
  if (!match || match.index === undefined) {
    return -1;
  }
  return match.index;
}

function tryExtractStitches(bytes: Uint8Array): StitchPoint[] | null {
  const candidates: { offset: number; reader: 'dst' | 'pes' }[] = [];

  const la = findLaHeaderOffset(bytes);
  if (la >= 0) {
    candidates.push({ offset: la + 512, reader: 'dst' });
  }

  const pes = findPesOffset(bytes);
  if (pes >= 0) {
    candidates.push({ offset: pes, reader: 'pes' });
  }

  for (const start of [0, 512, 1024, 0x30, 0x71]) {
    if (start < bytes.length - 32) {
      candidates.push({ offset: start, reader: 'dst' });
    }
  }

  for (const { offset, reader } of candidates) {
    try {
      const stitches =
        reader === 'pes' ? readPesStitches(bytes.buffer, offset) : readDstStitches(bytes, offset);
      if (stitches.length >= 8) {
        return stitches;
      }
    } catch {
      // try next offset
    }
  }

  const maxScan = Math.min(bytes.length - 600, 1_500_000);
  for (let offset = 0; offset < maxScan; offset += 128) {
    try {
      const stitches = readDstStitches(bytes, offset);
      if (stitches.length >= 20) {
        return stitches;
      }
    } catch {
      // continue scan
    }
  }

  return null;
}

function toUint8Array(content: unknown): Uint8Array | null {
  if (!content) {
    return null;
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  if (Array.isArray(content)) {
    return Uint8Array.from(content as number[]);
  }
  return null;
}

function extractStreams(buffer: ArrayBuffer): { name: string; data: Uint8Array }[] {
  const bytes = new Uint8Array(buffer);
  const cfbFile = CFB.read(bytes, { type: 'array' });
  const streams: { name: string; data: Uint8Array }[] = [];

  for (let i = 0; i < cfbFile.FullPaths.length; i++) {
    const entry = cfbFile.FileIndex[i];
    if (!entry || entry.type !== 2) {
      continue;
    }
    const path = cfbFile.FullPaths[i];
    const name = path.replace(/^Root Entry[/\\]?/i, '').replace(/^[/\\]+/, '') || path;
    const data = toUint8Array(entry.content);
    if (data && data.length > 0 && !streams.some((s) => s.name === name)) {
      streams.push({ name, data });
    }
  }

  const contentsEntry = CFB.find(cfbFile, 'Contents');
  if (contentsEntry?.content) {
    const data = toUint8Array(contentsEntry.content);
    if (data && data.length > 0 && !streams.some((s) => s.name.toLowerCase() === 'contents')) {
      streams.unshift({ name: 'Contents', data });
    }
  }

  if (streams.length === 0) {
    return [{ name: 'raw', data: bytes }];
  }

  streams.sort((a, b) => {
    const priority = (name: string) => {
      const n = name.toLowerCase();
      if (n === 'contents') return 0;
      if (n.includes('stitch') || n.includes('design')) return 1;
      if (n.includes('wilcom')) return 2;
      return 3;
    };
    return priority(a.name) - priority(b.name);
  });

  return streams;
}

export function readEmb(buffer: ArrayBuffer, fileName: string): ImageTraceResult {
  const bytes = new Uint8Array(buffer);
  if (!isOleCompoundFile(bytes)) {
    throw new Error('Archivo EMB inválido (no es un documento OLE de Wilcom)');
  }

  const streams = extractStreams(buffer);
  const isArt = /\.art$/i.test(fileName);

  for (const stream of streams) {
    const streamName = stream.name.toLowerCase();
    const swizzle = isArt && (streamName === 'contents' || streamName === 'design_icon');
    const payloads = decompressStreamPayload(stream.data, swizzle);

    for (const payload of payloads) {
      const stitches = tryExtractStitches(payload);
      if (stitches) {
        const baseName = fileName.replace(/\.[^.]+$/, '');
        return buildImportResult(baseName, stitches, undefined);
      }
    }

    const direct = tryExtractStitches(stream.data);
    if (direct) {
      return buildImportResult(fileName.replace(/\.[^.]+$/, ''), direct, undefined);
    }
  }

  throw new Error(
    'No se pudieron extraer puntadas del EMB. El diseño puede usar una versión muy nueva de Wilcom.',
  );
}
