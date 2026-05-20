export type HoopSize = '110x110' | '50x50' | '140x200' | '126x110' | '200x200';

export type ShapeType = 'rect' | 'ellipse' | 'line' | 'text' | 'polygon' | 'stitchpath';

export type StitchType = 'fill' | 'satin' | 'running';

export type CanvasViewMode = 'design' | 'stitch' | 'both';

export interface ThreadColor {
  id: string;
  name: string;
  hex: string;
  jefIndex: number;
}

export interface DesignShape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  colorId: string;
  text?: string;
  fontFamily?: string;
  stitchType: StitchType;
  label?: string;
  source?: 'manual' | 'trace' | 'import';
  points?: { x: number; y: number }[];
  jumps?: number[];
  density?: number;
  pullCompensation?: number;
  underlay?: boolean;
  groupId?: string;
}

export interface BackgroundImage {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
}

export interface EmbroideryDesign {
  name: string;
  hoopSize: HoopSize;
  colors: ThreadColor[];
  shapes: DesignShape[];
  backgroundImage?: BackgroundImage | null;
  createdAt: string;
  version: string;
}

export interface StitchPoint {
  x: number;
  y: number;
  command: number;
}

export interface ImageTraceOptions {
  maxColors: number;
  detail: number;
  stitchType: StitchType;
  keepBackground: boolean;
  snapToRealThreads?: boolean;
}

export interface ImageTraceResult {
  name: string;
  colors: ThreadColor[];
  shapes: DesignShape[];
  backgroundImage: BackgroundImage | null;
}

export const HOOP_DIMENSIONS: Record<HoopSize, { width: number; height: number; label: string }> = {
  '110x110': { width: 1100, height: 1100, label: '110 × 110 mm' },
  '50x50': { width: 500, height: 500, label: '50 × 50 mm' },
  '140x200': { width: 1400, height: 2000, label: '140 × 200 mm' },
  '126x110': { width: 1260, height: 1100, label: '126 × 110 mm' },
  '200x200': { width: 2000, height: 2000, label: '200 × 200 mm' },
};

export const STITCH_COMMAND = {
  STITCH: 0,
  JUMP: 1,
  TRIM: 2,
  STOP: 4,
  END: 8,
  COLOR_CHANGE: 16,
  SEQUIN_EJECT: 32,
} as const;

export const COMMAND_MASK = 0xff;
