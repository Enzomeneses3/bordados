import { COMMAND_MASK, STITCH_COMMAND, StitchPoint } from '../../models/embroidery.model';

const DST_HEADER_SIZE = 512;

function bit(b: number): number {
  return 1 << b;
}

function encodeRecord(x: number, y: number, flags: number): Uint8Array {
  y = -y;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;

  if (flags === STITCH_COMMAND.JUMP) {
    b2 += bit(7);
  }
  if (flags === STITCH_COMMAND.STITCH || flags === STITCH_COMMAND.JUMP) {
    b2 += bit(0);
    b2 += bit(1);
  }

  if (x > 40) {
    b2 += bit(2);
    x -= 81;
  }
  if (x < -40) {
    b2 += bit(3);
    x += 81;
  }
  if (x > 13) {
    b1 += bit(2);
    x -= 27;
  }
  if (x < -13) {
    b1 += bit(3);
    x += 27;
  }
  if (x > 4) {
    b0 += bit(2);
    x -= 9;
  }
  if (x < -4) {
    b0 += bit(3);
    x += 9;
  }
  if (x > 1) {
    b1 += bit(0);
    x -= 3;
  }
  if (x < -1) {
    b1 += bit(1);
    x += 3;
  }
  if (x > 0) {
    b0 += bit(0);
    x -= 1;
  }
  if (x < 0) {
    b0 += bit(1);
    x += 1;
  }

  if (y > 40) {
    b2 += bit(5);
    y -= 81;
  }
  if (y < -40) {
    b2 += bit(4);
    y += 81;
  }
  if (y > 13) {
    b1 += bit(5);
    y -= 27;
  }
  if (y < -13) {
    b1 += bit(4);
    y += 27;
  }
  if (y > 4) {
    b0 += bit(5);
    y -= 9;
  }
  if (y < -4) {
    b0 += bit(4);
    y += 9;
  }
  if (y > 1) {
    b1 += bit(7);
    y -= 3;
  }
  if (y < -1) {
    b1 += bit(6);
    y += 3;
  }
  if (y > 0) {
    b0 += bit(7);
    y -= 1;
  }
  if (y < 0) {
    b0 += bit(6);
    y += 1;
  }

  if (flags === STITCH_COMMAND.COLOR_CHANGE || flags === STITCH_COMMAND.STOP) {
    b2 = 0b11000011;
  } else if (flags === STITCH_COMMAND.END) {
    b2 = 0b11110011;
  }

  return new Uint8Array([b0, b1, b2]);
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

function countStitches(stitches: StitchPoint[]): number {
  return stitches.filter((s) => (s.command & COMMAND_MASK) === STITCH_COMMAND.STITCH).length;
}

function countColorChanges(stitches: StitchPoint[]): number {
  return stitches.filter((s) => (s.command & COMMAND_MASK) === STITCH_COMMAND.COLOR_CHANGE).length;
}

function writeAsciiHeader(parts: string[], targetLength: number): Uint8Array {
  const header = new Uint8Array(targetLength);
  const text = parts.join('');
  for (let i = 0; i < text.length && i < targetLength; i++) {
    header[i] = text.charCodeAt(i);
  }
  header[Math.min(text.length, targetLength - 1)] = 0x1a;
  for (let i = text.length + 1; i < targetLength; i++) {
    header[i] = 0x20;
  }
  return header;
}

export function writeDstFile(stitches: StitchPoint[], designName: string): Blob {
  const bounds = getBounds(stitches);
  const name = designName.slice(0, 16).padEnd(16, ' ');
  const header = writeAsciiHeader(
    [
      `LA:${name}\r`,
      `ST:${countStitches(stitches).toString().padStart(7, ' ')}\r`,
      `CO:${countColorChanges(stitches).toString().padStart(3, ' ')}\r`,
      `+X:${Math.abs(Math.round(bounds[2])).toString().padStart(5, ' ')}\r`,
      `-X:${Math.abs(Math.round(bounds[0])).toString().padStart(5, ' ')}\r`,
      `+Y:${Math.abs(Math.round(bounds[3])).toString().padStart(5, ' ')}\r`,
      `-Y:${Math.abs(Math.round(bounds[1])).toString().padStart(5, ' ')}\r`,
      `AX:+${'0'.padStart(5, ' ')}\r`,
      `AY:+${'0'.padStart(5, ' ')}\r`,
      `MX:+${'0'.padStart(5, ' ')}\r`,
      `MY:+${'0'.padStart(5, ' ')}\r`,
      `PD:${'******'.padStart(6, ' ')}\r`,
    ],
    DST_HEADER_SIZE,
  );

  const bodyChunks: Uint8Array[] = [];
  let xx = 0;
  let yy = 0;

  for (const stitch of stitches) {
    const command = stitch.command & COMMAND_MASK;
    const dx = Math.round(stitch.x - xx);
    const dy = Math.round(stitch.y - yy);
    xx += dx;
    yy += dy;

    if (command === STITCH_COMMAND.END) {
      bodyChunks.push(encodeRecord(0, 0, STITCH_COMMAND.END));
      break;
    }

    bodyChunks.push(encodeRecord(dx, dy, command));
  }

  const bodyLength = bodyChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(header.length + bodyLength);
  output.set(header, 0);
  let offset = header.length;
  for (const chunk of bodyChunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([output], { type: 'application/octet-stream' });
}
