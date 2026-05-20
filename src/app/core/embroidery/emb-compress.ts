/**
 * Decompresión Wilcom/Pulse (HUS, streams internos EMB).
 * Port de pyembroidery/EmbCompress.py
 */
export class EmbCompress {
  private bitPosition = 0;
  private inputData: Uint8Array | null = null;
  private blockElements = -1;
  private characterHuffman: Huffman | null = null;
  private distanceHuffman: Huffman | null = null;

  decompress(inputData: Uint8Array, uncompressedSize?: number): Uint8Array {
    this.inputData = inputData;
    this.bitPosition = 0;
    this.blockElements = -1;
    const output: number[] = [];
    const bitsTotal = inputData.length * 8;

    while (bitsTotal > this.bitPosition) {
      if (uncompressedSize !== undefined && output.length > uncompressedSize) {
        break;
      }
      const character = this.getToken();
      if (character <= 255) {
        output.push(character);
      } else if (character === 510) {
        break;
      } else {
        const length = character - 253;
        const back = this.getPosition() + 1;
        const position = output.length - back;
        if (back > length) {
          for (let i = 0; i < length; i++) {
            output.push(output[position + i]);
          }
        } else {
          for (let i = 0; i < length; i++) {
            output.push(output[position + i]);
          }
        }
      }
    }

    return Uint8Array.from(output);
  }

  private getBits(startPosInBits: number, length: number): number {
    const endPosInBits = startPosInBits + length - 1;
    const startPosInBytes = Math.floor(startPosInBits / 8);
    const endPosInBytes = Math.floor(endPosInBits / 8);
    let value = 0;
    for (let i = startPosInBytes; i <= endPosInBytes; i++) {
      value <<= 8;
      value |= this.inputData?.[i] ?? 0;
    }
    const unusedBitsRight = (8 - ((endPosInBits + 1) % 8)) % 8;
    const mask = (1 << length) - 1;
    return (value >> unusedBitsRight) & mask;
  }

  private pop(bitCount: number): number {
    const value = this.peek(bitCount);
    this.bitPosition += bitCount;
    return value;
  }

  private peek(bitCount: number): number {
    return this.getBits(this.bitPosition, bitCount);
  }

  private readVariableLength(): number {
    let m = this.pop(3);
    if (m !== 7) {
      return m;
    }
    for (let q = 0; q < 13; q++) {
      const s = this.pop(1);
      if (s === 1) {
        m += 1;
      } else {
        break;
      }
    }
    return m;
  }

  private loadCharacterLengthHuffman(): Huffman {
    const count = this.pop(5);
    if (count === 0) {
      return new Huffman(null, this.pop(5));
    }
    const lengths: number[] = Array(count).fill(0);
    let index = 0;
    while (index < count) {
      if (index === 3) {
        index += this.pop(2);
      }
      lengths[index] = this.readVariableLength();
      index += 1;
    }
    const huffman = new Huffman(lengths, 8);
    huffman.buildTable();
    return huffman;
  }

  private loadCharacterHuffman(lengthHuffman: Huffman): Huffman {
    const count = this.pop(9);
    if (count === 0) {
      return new Huffman(null, this.pop(9));
    }
    const lengths: number[] = Array(count).fill(0);
    let index = 0;
    while (index < count) {
      const h = lengthHuffman.lookup(this.peek(16));
      const c = h[0];
      this.bitPosition += h[1];
      if (c === 0) {
        index += 1;
      } else if (c === 1) {
        index += 3 + this.pop(4);
      } else if (c === 2) {
        index += 20 + this.pop(9);
      } else {
        lengths[index] = c - 2;
        index += 1;
      }
    }
    const huffman = new Huffman(lengths);
    huffman.buildTable();
    return huffman;
  }

  private loadDistanceHuffman(): Huffman {
    const count = this.pop(5);
    if (count === 0) {
      return new Huffman(null, this.pop(5));
    }
    const lengths: number[] = Array(count).fill(0);
    for (let index = 0; index < count; index++) {
      lengths[index] = this.readVariableLength();
    }
    const huffman = new Huffman(lengths);
    huffman.buildTable();
    return huffman;
  }

  private loadBlock(): void {
    this.blockElements = this.pop(16);
    const characterLengthHuffman = this.loadCharacterLengthHuffman();
    this.characterHuffman = this.loadCharacterHuffman(characterLengthHuffman);
    this.distanceHuffman = this.loadDistanceHuffman();
  }

  private getToken(): number {
    if (this.blockElements <= 0) {
      this.loadBlock();
    }
    this.blockElements -= 1;
    const h = this.characterHuffman!.lookup(this.peek(16));
    this.bitPosition += h[1];
    return h[0];
  }

  private getPosition(): number {
    const h = this.distanceHuffman!.lookup(this.peek(16));
    this.bitPosition += h[1];
    if (h[0] === 0) {
      return 0;
    }
    let v = h[0] - 1;
    v = (1 << v) + this.pop(v);
    return v;
  }
}

class Huffman {
  private table: number[] | null = null;
  private tableWidth = 0;

  constructor(
    private readonly lengths: number[] | null,
    private readonly defaultValue = 0,
  ) {}

  buildTable(): void {
    if (!this.lengths) {
      return;
    }
    this.tableWidth = Math.max(...this.lengths);
    this.table = [];
    for (let bitLength = 1; bitLength <= this.tableWidth; bitLength++) {
      const size = 1 << (this.tableWidth - bitLength);
      for (let lenIndex = 0; lenIndex < this.lengths.length; lenIndex++) {
        if (this.lengths[lenIndex] === bitLength) {
          this.table.push(...Array(size).fill(lenIndex));
        }
      }
    }
  }

  lookup(byteLookup: number): [number, number] {
    if (!this.table || !this.lengths) {
      return [this.defaultValue, 0];
    }
    const v = this.table[byteLookup >> (16 - this.tableWidth)];
    return [v, this.lengths[v]];
  }
}

export function expandEmbCompress(data: Uint8Array, uncompressedSize?: number): Uint8Array {
  return new EmbCompress().decompress(data, uncompressedSize);
}
