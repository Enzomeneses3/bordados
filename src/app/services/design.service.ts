import { Injectable, signal } from '@angular/core';
import { ImageTraceService } from '../core/embroidery/image-trace.service';
import { countDesignStitches } from '../core/embroidery/stitch-generator';
import { applyQualityToDesign } from '../core/embroidery/design-quality';
import {
  applyStitchImport,
  isStitchFileName,
  readStitchFile,
} from '../core/embroidery/stitch-file-reader';
import { findNearestJefIndex, JEF_THREAD_PALETTE } from '../core/constants/jef-colors';
import {
  BackgroundImage,
  CanvasViewMode,
  DesignShape,
  EmbroideryDesign,
  HoopSize,
  ImageTraceOptions,
  ImageTraceResult,
  ShapeType,
  StitchType,
  ThreadColor,
} from '../models/embroidery.model';

function createId(): string {
  return crypto.randomUUID();
}

function defaultColors(): ThreadColor[] {
  return [
    { id: createId(), name: 'Negro', hex: '#1a1a1a', jefIndex: 1 },
    { id: createId(), name: 'Rojo', hex: '#e63946', jefIndex: 10 },
    { id: createId(), name: 'Azul', hex: '#2563eb', jefIndex: 12 },
    { id: createId(), name: 'Verde', hex: '#2a9d8f', jefIndex: 6 },
  ];
}

function sampleShape(type: ShapeType, colorId: string): DesignShape {
  const base = {
    id: createId(),
    type,
    colorId,
    rotation: 0,
    stitchType: 'running' as StitchType,
    source: 'manual' as const,
  };

  switch (type) {
    case 'rect':
      return { ...base, x: 0, y: 0, width: 400, height: 280, stitchType: 'fill' };
    case 'ellipse':
      return { ...base, x: 0, y: 0, width: 360, height: 360, stitchType: 'satin' };
    case 'line':
      return { ...base, x: 0, y: 0, width: 500, height: 20, stitchType: 'running' };
    case 'text':
      return { ...base, x: 0, y: 0, width: 420, height: 120, text: 'JANOME', stitchType: 'running' };
    case 'polygon':
      return { ...base, x: 0, y: 0, width: 300, height: 300, stitchType: 'fill', points: [] };
    default:
      return { ...base, x: 0, y: 0, width: 300, height: 300, stitchType: 'fill' };
  }
}

@Injectable({ providedIn: 'root' })
export class DesignService {
  readonly design = signal<EmbroideryDesign>(this.createEmptyDesign());
  readonly selectedShapeId = signal<string | null>(null);
  readonly activeTool = signal<ShapeType>('rect');
  readonly activeStitchType = signal<StitchType>('fill');
  readonly activeColorId = signal<string>('');
  readonly canvasViewMode = signal<CanvasViewMode>('both');
  readonly isTracing = signal(false);
  readonly statusMessage = signal<string | null>(null);

  private history: EmbroideryDesign[] = [];
  private redoList: EmbroideryDesign[] = [];
  private lastCommitTime = 0;
  private qualitySourceShapes: DesignShape[] | null = null;
  private qualitySourceColors: ThreadColor[] | null = null;

  commitHistoryState(coalesce = false): void {
    const now = Date.now();
    if (coalesce && now - this.lastCommitTime < 1200) {
      return;
    }
    const current = JSON.parse(JSON.stringify(this.design()));
    this.history.push(current);
    if (this.history.length > 50) {
      this.history.shift();
    }
    this.redoList = [];
    this.lastCommitTime = now;
  }

  undo(): void {
    if (this.history.length === 0) {
      this.showStatus('Nada para deshacer ↩️');
      return;
    }
    const previous = this.history.pop()!;
    const current = JSON.parse(JSON.stringify(this.design()));
    this.redoList.push(current);
    this.design.set(previous);
    this.showStatus('Deshecho ↩️');
  }

  redo(): void {
    if (this.redoList.length === 0) {
      this.showStatus('Nada para rehacer ↪️');
      return;
    }
    const next = this.redoList.pop()!;
    const current = JSON.parse(JSON.stringify(this.design()));
    this.history.push(current);
    this.design.set(next);
    this.showStatus('Rehecho ↪️');
  }

  constructor(private readonly imageTraceService: ImageTraceService) {
    const colors = this.design().colors;
    this.activeColorId.set(colors[0]?.id ?? '');
  }

  createEmptyDesign(): EmbroideryDesign {
    return {
      name: 'Mi diseño',
      hoopSize: '110x110',
      colors: defaultColors(),
      shapes: [],
      backgroundImage: null,
      createdAt: new Date().toISOString(),
      version: '1.1.0',
    };
  }

  updateDesign(partial: Partial<EmbroideryDesign>): void {
    this.commitHistoryState(false);
    this.design.update((current) => ({ ...current, ...partial }));
  }

  setHoopSize(hoopSize: HoopSize): void {
    this.commitHistoryState(false);
    this.updateDesign({ hoopSize });
  }

  addShape(type: ShapeType): void {
    const colorId = this.activeColorId() || this.design().colors[0]?.id;
    if (!colorId) {
      return;
    }
    this.commitHistoryState(false);
    const shape = sampleShape(type, colorId);
    shape.stitchType = this.activeStitchType();
    this.design.update((current) => ({
      ...current,
      shapes: [...current.shapes, shape],
    }));
    this.selectedShapeId.set(shape.id);
    this.showStatus('Forma agregada al diseño');
  }

  updateShape(shapeId: string, partial: Partial<DesignShape>): void {
    const target = this.design().shapes.find((s) => s.id === shapeId);
    if (!target) return;

    this.design.update((current) => {
      const isGrouped = !!target.groupId;

      return {
        ...current,
        shapes: current.shapes.map((shape) => {
          if (isGrouped && shape.groupId !== target.groupId) {
            return shape;
          }
          if (!isGrouped && shape.id !== shapeId) {
            return shape;
          }

          if (shape.id === shapeId) {
            return { ...shape, ...partial };
          }

          const updatedShape = { ...shape };

          if (partial.x !== undefined) {
            const dx = partial.x - target.x;
            updatedShape.x = shape.x + dx;
          }
          if (partial.y !== undefined) {
            const dy = partial.y - target.y;
            updatedShape.y = shape.y + dy;
          }

          if (partial.colorId !== undefined) {
            updatedShape.colorId = partial.colorId;
          }

          if (partial.rotation !== undefined) {
            const dRot = partial.rotation - target.rotation;
            updatedShape.rotation = (shape.rotation + dRot) % 360;
          }

          if (partial.width !== undefined && target.width > 0) {
            const scaleX = partial.width / target.width;
            updatedShape.width = shape.width * scaleX;
            const dx = shape.x - target.x;
            updatedShape.x = target.x + dx * scaleX;
          }
          if (partial.height !== undefined && target.height > 0) {
            const scaleY = partial.height / target.height;
            updatedShape.height = shape.height * scaleY;
            const dy = shape.y - target.y;
            updatedShape.y = target.y + dy * scaleY;
          }

          return updatedShape;
        }),
      };
    });
  }

  removeShape(shapeId: string): void {
    const target = this.design().shapes.find((s) => s.id === shapeId);
    const groupId = target?.groupId;

    this.commitHistoryState(false);
    this.design.update((current) => ({
      ...current,
      shapes: current.shapes.filter((shape) => {
        if (groupId && shape.groupId === groupId) {
          return false;
        }
        return shape.id !== shapeId;
      }),
    }));
    if (this.selectedShapeId() === shapeId) {
      this.selectedShapeId.set(null);
    }
  }

  removeTracedShapes(): void {
    this.commitHistoryState(false);
    this.design.update((current) => ({
      ...current,
      shapes: current.shapes.filter((shape) => shape.source !== 'trace'),
    }));
    this.showStatus('Regiones importadas eliminadas');
  }

  selectShape(shapeId: string | null): void {
    this.selectedShapeId.set(shapeId);
    if (shapeId) {
      const shape = this.design().shapes.find((item) => item.id === shapeId);
      if (shape) {
        this.activeColorId.set(shape.colorId);
      }
    }
  }

  addColor(name: string, hex: string): void {
    this.commitHistoryState(false);
    const color: ThreadColor = {
      id: createId(),
      name,
      hex,
      jefIndex: findNearestJefIndex(hex),
    };
    this.design.update((current) => ({
      ...current,
      colors: [...current.colors, color],
    }));
    this.activeColorId.set(color.id);
  }

  updateColor(colorId: string, partial: Partial<ThreadColor>): void {
    this.commitHistoryState(true);
    this.design.update((current) => ({
      ...current,
      colors: current.colors.map((color) => {
        if (color.id !== colorId) {
          return color;
        }
        const updated = { ...color, ...partial };
        if (partial.hex) {
          updated.jefIndex = findNearestJefIndex(updated.hex);
        }
        return updated;
      }),
    }));
  }

  removeColor(colorId: string): void {
    const fallback = this.design().colors.find((color) => color.id !== colorId)?.id;
    this.commitHistoryState(false);
    this.design.update((current) => ({
      ...current,
      colors: current.colors.filter((color) => color.id !== colorId),
      shapes: current.shapes.map((shape) =>
        shape.colorId === colorId ? { ...shape, colorId: fallback ?? colorId } : shape,
      ),
    }));
    if (this.activeColorId() === colorId && fallback) {
      this.activeColorId.set(fallback);
    }
  }

  updateBackgroundImage(partial: Partial<BackgroundImage>): void {
    this.commitHistoryState(false);
    this.design.update((current) => {
      if (!current.backgroundImage) {
        return current;
      }
      return {
        ...current,
        backgroundImage: { ...current.backgroundImage, ...partial },
      };
    });
  }

  toggleBackgroundVisibility(): void {
    const bg = this.design().backgroundImage;
    if (bg) {
      this.updateBackgroundImage({ visible: !bg.visible });
    }
  }

  setQualitySource(shapes: DesignShape[], colors?: ThreadColor[]): void {
    this.qualitySourceShapes = JSON.parse(JSON.stringify(shapes)) as DesignShape[];
    const palette = colors ?? this.design().colors;
    this.qualitySourceColors = JSON.parse(JSON.stringify(palette)) as ThreadColor[];
  }

  hasQualitySource(): boolean {
    return (this.qualitySourceShapes?.length ?? 0) > 0;
  }

  canRetraceFromImage(): boolean {
    return !!this.design().backgroundImage?.src;
  }

  applyQualityPreview(options: ImageTraceOptions): void {
    if (!this.qualitySourceShapes?.length) {
      return;
    }
    const palette = this.qualitySourceColors ?? this.design().colors;
    const next = applyQualityToDesign(this.design(), this.qualitySourceShapes, palette, options);
    this.design.set(next);
  }

  loadDesign(design: EmbroideryDesign, clearHistory = true, captureQualitySource = clearHistory): void {
    if (clearHistory) {
      this.history = [];
      this.redoList = [];
    } else {
      this.commitHistoryState(false);
    }
    this.design.set(design);
    this.selectedShapeId.set(design.shapes[0]?.id ?? null);
    this.activeColorId.set(design.colors[0]?.id ?? '');
    if (captureQualitySource && design.shapes.length > 0) {
      this.setQualitySource(design.shapes, design.colors);
    }
    if (clearHistory && design.shapes.length === 0) {
      this.qualitySourceShapes = null;
      this.qualitySourceColors = null;
    }
  }

  applyTraceResult(result: ImageTraceResult, replaceTraced = true): void {
    const design = this.imageTraceService.applyTraceToDesign(this.design(), result, replaceTraced);
    const isRetrace = !!this.design().backgroundImage;
    this.loadDesign(design, !isRetrace, true);
    this.setQualitySource(design.shapes, design.colors);
    this.selectedShapeId.set(result.shapes[0]?.id ?? null);
    const stitches = countDesignStitches(design);
    this.showStatus(
      `Listo: ${result.shapes.length} capa(s) · ${stitches.toLocaleString('es-AR')} puntadas estimadas`,
    );
  }

  async importPng(file: File, options: ImageTraceOptions): Promise<void> {
    this.isTracing.set(true);
    try {
      this.statusMessage.set('IA interna: detectando fondo y sector del logo...');
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      this.statusMessage.set('IA interna: separando figura, colores y regiones...');
      const result = await this.imageTraceService.traceImage(file, this.design().hoopSize, options);
      if (result.shapes.length === 0) {
        throw new Error('No se detectaron áreas para bordar');
      }
      this.statusMessage.set('IA interna: generando puntadas editables...');
      this.applyTraceResult(result, true);
    } finally {
      this.isTracing.set(false);
    }
  }

  async importEmbroideryFile(file: File): Promise<void> {
    this.isTracing.set(true);
    try {
      this.statusMessage.set('Leyendo archivo de bordado...');
      const result = await readStitchFile(file);
      const design = applyStitchImport(this.design(), result);
      this.loadDesign(design);
      const stitches = countDesignStitches(design);
      this.showStatus(
        `Archivo importado: ${result.shapes.length} color(es) · ${stitches.toLocaleString('es-AR')} puntadas`,
      );
    } finally {
      this.isTracing.set(false);
    }
  }

  async importAnyFile(file: File, options: ImageTraceOptions): Promise<void> {
    if (isStitchFileName(file.name)) {
      await this.importEmbroideryFile(file);
      return;
    }
    if (file.type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(file.name)) {
      await this.importPng(file, options);
      return;
    }
    throw new Error('Formato no soportado. Prueba con PNG, JPG, DST, PES, PEC o EMB.');
  }

  resetDesign(): void {
    this.qualitySourceShapes = null;
    this.qualitySourceColors = null;
    this.loadDesign(this.createEmptyDesign());
    this.showStatus('Nuevo diseño creado');
  }

  showStatus(message: string): void {
    this.statusMessage.set(message);
    window.setTimeout(() => {
      if (this.statusMessage() === message) {
        this.statusMessage.set(null);
      }
    }, 3200);
  }

  getJefPalette() {
    return JEF_THREAD_PALETTE;
  }
}
