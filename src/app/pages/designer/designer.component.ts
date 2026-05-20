import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DesignCanvasComponent } from '../../components/design-canvas/design-canvas.component';
import { GarmentMockupComponent, GarmentType } from '../../components/garment-mockup/garment-mockup.component';
import {
  CanvasViewMode,
  COMMAND_MASK,
  DesignShape,
  HOOP_DIMENSIONS,
  ImageTraceOptions,
  ShapeType,
  STITCH_COMMAND,
  StitchType,
} from '../../models/embroidery.model';
import { DesignService } from '../../services/design.service';
import { ExportFormat, ExportService } from '../../services/export.service';

type SidebarTab = 'create' | 'edit' | 'export';
type WorkspaceView = 'editor' | 'mockup';

@Component({
  selector: 'app-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, DesignCanvasComponent, GarmentMockupComponent],
  templateUrl: './designer.component.html',
  styleUrl: './designer.component.scss',
})
export class DesignerComponent {
  readonly designService = inject(DesignService);
  readonly exportService = inject(ExportService);

  readonly design = this.designService.design;
  readonly activeTab = signal<SidebarTab>('create');
  readonly workspaceView = signal<WorkspaceView>('editor');
  readonly isDraggingFile = signal(false);
  readonly garmentType = signal<GarmentType>('tshirt-white');
  readonly mockupScale = signal(1);
  readonly expertMode = signal(false);
  readonly hasStarted = signal(false);

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    const activeEl = document.activeElement;
    const isInput = activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'SELECT' || 
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.getAttribute('contenteditable') === 'true'
    );

    // Ctrl+Z
    if (event.ctrlKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.designService.undo();
      return;
    }

    // Ctrl+Y
    if (event.ctrlKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.designService.redo();
      return;
    }

    // Delete / Backspace (only if not typing in an input field)
    if (!isInput && (event.key === 'Delete' || event.key === 'Backspace')) {
      const selectedId = this.designService.selectedShapeId();
      if (selectedId) {
        event.preventDefault();
        this.designService.removeShape(selectedId);
      }
    }
  }

  readonly totalDesignSize = computed(() => {
    const shapes = this.design().shapes;
    if (shapes.length === 0) return { width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const shape of shapes) {
      if (shape.type === 'stitchpath' && shape.points) {
        for (const pt of shape.points) {
          minX = Math.min(minX, shape.x + pt.x);
          minY = Math.min(minY, shape.y + pt.y);
          maxX = Math.max(maxX, shape.x + pt.x);
          maxY = Math.max(maxY, shape.y + pt.y);
        }
      } else {
        minX = Math.min(minX, shape.x - shape.width / 2);
        minY = Math.min(minY, shape.y - shape.height / 2);
        maxX = Math.max(maxX, shape.x + shape.width / 2);
        maxY = Math.max(maxY, shape.y + shape.height / 2);
      }
    }
    return { width: maxX - minX, height: maxY - minY };
  });

  readonly selectedShape = computed(() => {
    const id = this.designService.selectedShapeId();
    return this.design().shapes.find((shape) => shape.id === id) ?? null;
  });

  readonly tracedShapeCount = computed(() => this.design().shapes.filter((s) => s.source === 'trace').length);
  readonly stats = computed(() => this.exportService.getDesignStats(this.design()));
  readonly canRetraceFromImage = computed(() => this.designService.canRetraceFromImage());
  readonly hasQualityControls = computed(
    () => this.design().shapes.length > 0 || !!this.design().backgroundImage,
  );

  private qualityDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly tabs: { id: SidebarTab; label: string; icon: string }[] = [
    { id: 'create', label: 'Formas', icon: 'ph ph-shapes' },
    { id: 'export', label: 'Exportar', icon: 'ph ph-export' },
  ];



  readonly hoopOptions = Object.entries(HOOP_DIMENSIONS).map(([value, data]) => ({
    value,
    label: data.label,
  }));

  readonly tools: { type: ShapeType; label: string; icon: string }[] = [
    { type: 'rect', label: 'Rectángulo', icon: 'ph ph-rectangle' },
    { type: 'ellipse', label: 'Círculo', icon: 'ph ph-circle' },
    { type: 'line', label: 'Línea', icon: 'ph ph-line-segment' },
    { type: 'text', label: 'Texto', icon: 'ph ph-text-t' },
  ];

  readonly stitchTypes: { value: StitchType; label: string }[] = [
    { value: 'fill', label: 'Relleno' },
    { value: 'satin', label: 'Satinado' },
    { value: 'running', label: 'Contorno' },
  ];

  readonly garments: { value: GarmentType; label: string }[] = [
    { value: 'tshirt-white', label: 'Polera Blanca' },
    { value: 'tshirt-black', label: 'Polera Negra' },
    { value: 'cap-white', label: 'Gorra Blanca' },
    { value: 'cap-black', label: 'Gorra Negra' },
  ];

  readonly viewModes: { value: CanvasViewMode; label: string }[] = [
    { value: 'both', label: 'Diseño + puntadas' },
    { value: 'design', label: 'Solo diseño' },
    { value: 'stitch', label: 'Solo puntadas' },
  ];

  readonly exportFormats: { value: ExportFormat; label: string; hint: string }[] = [
    {
      value: 'jef',
      label: 'JEF — Janome',
      hint: 'Ideal para máquinas Janome y Artistic Digitizer',
    },
    {
      value: 'dst',
      label: 'DST — Universal',
      hint: 'Compatible con casi todo el software de bordado',
    },
    {
      value: 'bord',
      label: 'Proyecto editable',
      hint: 'Guarda formas, colores e imagen de referencia',
    },
    {
      value: 'png',
      label: 'PNG — Imagen de alta calidad',
      hint: 'Captura la vista actual (Editor o Simulador 3D)',
    },
    {
      value: 'jpg',
      label: 'JPG — Imagen plana',
      hint: 'Captura la vista actual con fondo sólido',
    },
  ];

  traceOptions: ImageTraceOptions = {
    maxColors: 6,
    detail: 7,
    stitchType: 'fill',
    keepBackground: false,
    snapToRealThreads: true,
  };

  newColorName = 'Nuevo color';
  newColorHex = '#f97316';

  setTab(tab: SidebarTab): void {
    this.activeTab.set(tab);
  }

  setWorkspace(view: WorkspaceView): void {
    this.workspaceView.set(view);
  }

  startBlank(): void {
    this.designService.resetDesign();
    this.hasStarted.set(true);
  }

  startNewProject(): void {
    this.designService.resetDesign();
    this.hasStarted.set(false);
  }

  loadSampleDesign(): void {
    this.designService.resetDesign();
    const colors = this.design().colors;
    
    // Create an 8-pointed star path (center at x=550, y=550)
    const points: { x: number; y: number }[] = [];
    const numPoints = 8;
    const outerRadius = 150;
    const innerRadius = 70;
    for (let i = 0; i < numPoints * 2; i++) {
      const angle = (i * Math.PI) / numPoints;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    points.push({ ...points[0] });

    const shapes: DesignShape[] = [
      {
        id: crypto.randomUUID(),
        type: 'stitchpath',
        x: 550,
        y: 550,
        width: 300,
        height: 300,
        rotation: 0,
        colorId: colors[1]?.id || colors[0].id, // Red
        stitchType: 'fill',
        label: 'Estrella Tatami (Muestra)',
        source: 'trace',
        points,
        jumps: [],
      },
      {
        id: crypto.randomUUID(),
        type: 'text',
        x: 550,
        y: 750,
        width: 500,
        height: 80,
        rotation: 0,
        colorId: colors[2]?.id || colors[0].id, // Blue
        stitchType: 'satin',
        text: 'BORDADORAS',
        fontFamily: 'Impact',
        label: 'Texto Bordado (Muestra)',
      },
    ];

    this.designService.updateDesign({
      name: 'Diseño de Muestra - Estrella',
      shapes,
    });
    this.hasStarted.set(true);
    this.designService.showStatus('Cargado diseño de muestra: Estrella y Texto');
  }

  addShape(type: ShapeType): void {
    this.designService.activeTool.set(type);
    this.designService.addShape(type);
  }



  updateSelectedShape(partial: Partial<DesignShape>): void {
    const shape = this.selectedShape();
    if (!shape) {
      return;
    }
    this.designService.commitHistoryState(true);
    this.designService.updateShape(shape.id, partial);
  }

  scaleDesignProportionally(newWidth: number): void {
    const currentSize = this.totalDesignSize();
    if (currentSize.width === 0 || newWidth <= 0) return;
    this.designService.commitHistoryState(false);
    const factor = newWidth / currentSize.width;
    
    const shapes = this.design().shapes.map(shape => {
      const scaledShape = { ...shape, x: shape.x * factor, y: shape.y * factor };
      if (shape.type === 'stitchpath' && shape.points) {
        scaledShape.points = shape.points.map(p => ({ x: p.x * factor, y: p.y * factor }));
      }
      scaledShape.width = shape.width * factor;
      scaledShape.height = shape.height * factor;
      return scaledShape;
    });
    
    this.designService.updateDesign({ shapes });
  }

  removeSelectedShape(): void {
    const shape = this.selectedShape();
    if (shape) {
      this.designService.removeShape(shape.id);
    }
  }

  export(format: ExportFormat): void {
    if (format === 'png' || format === 'jpg') {
      const design = this.design();
      const stitches = this.exportService.generateStitches(design);
      
      if (stitches.length === 0) {
        this.designService.showStatus('El diseño no tiene puntadas para exportar');
        return;
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const stitch of stitches) {
        if ((stitch.command & COMMAND_MASK) === STITCH_COMMAND.END) continue;
        minX = Math.min(minX, stitch.x);
        minY = Math.min(minY, stitch.y);
        maxX = Math.max(maxX, stitch.x);
        maxY = Math.max(maxY, stitch.y);
      }

      if (minX === Infinity) return;

      const padding = 40;
      const scale = 3; 
      
      const width = (maxX - minX) * scale + padding * 2;
      const height = (maxY - minY) * scale + padding * 2;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(10, width);
      canvas.height = Math.max(10, height);
      const ctx = canvas.getContext('2d')!;

      if (format === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);

      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 1.5;
      ctx.shadowOffsetX = 0.5;
      ctx.shadowOffsetY = 1;

      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const usedColors = design.colors.filter(c => design.shapes.some(s => s.colorId === c.id));
      let colorIndex = 0;
      let started = false;
      ctx.beginPath();

      for (const stitch of stitches) {
        const cmd = stitch.command & COMMAND_MASK;
        if (cmd === STITCH_COMMAND.COLOR_CHANGE) {
          colorIndex += 1;
          ctx.stroke();
          ctx.beginPath();
        }
        
        const color = usedColors[colorIndex]?.hex ?? '#334155';
        ctx.strokeStyle = color;
        
        if (cmd === STITCH_COMMAND.JUMP) {
          ctx.moveTo(stitch.x, stitch.y);
        } else if (cmd !== STITCH_COMMAND.END && cmd !== STITCH_COMMAND.COLOR_CHANGE) {
          ctx.lineTo(stitch.x, stitch.y);
        }
      }
      ctx.stroke();
      ctx.restore();

      const safeName = design.name.trim().replace(/[^\w\- ]+/g, '') || 'diseno';
      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(mimeType, 0.95);
      
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${safeName}.${format}`;
      a.click();
      
      this.designService.showStatus(`Imagen ${format.toUpperCase()} descargada`);
      return;
    }

    this.exportService.exportDesign(this.design(), format);
    this.designService.showStatus(`Archivo ${format.toUpperCase()} descargado`);
  }

  onImportProject(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.exportService.importProjectFile(file)
      .then((design) => {
        this.designService.loadDesign(design);
        this.hasStarted.set(true);
        this.designService.showStatus('Proyecto importado');
      })
      .catch(() => this.designService.showStatus('No se pudo importar el proyecto'));
    input.value = '';
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.activeTab.set('create');
      this.processAnyFile(file);
    }
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingFile.set(true);
  }

  onDragLeave(): void {
    this.isDraggingFile.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingFile.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.processAnyFile(file);
    } else {
      this.designService.showStatus('Arrastra un PNG, JPG, DST, PES, PEC o EMB');
    }
  }

  async processAnyFile(file: File): Promise<void> {
    try {
      if (file.name.endsWith('.json')) {
        const design = await this.exportService.importProjectFile(file);
        this.designService.loadDesign(design);
        this.designService.showStatus('Proyecto importado');
      } else {
        await this.designService.importAnyFile(file, this.traceOptions);
      }
      this.hasStarted.set(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo abrir el archivo';
      this.designService.showStatus(message);
    }
  }

  onQualityChange(): void {
    if (!this.hasQualityControls()) {
      return;
    }
    if (this.qualityDebounceTimer) {
      clearTimeout(this.qualityDebounceTimer);
    }
    const delay = this.canRetraceFromImage() ? 400 : 80;
    this.qualityDebounceTimer = setTimeout(() => void this.applyQualityNow(), delay);
  }

  private async applyQualityNow(): Promise<void> {
    if (this.canRetraceFromImage()) {
      await this.retraceImage();
      return;
    }
    if (this.designService.hasQualitySource()) {
      this.designService.applyQualityPreview(this.traceOptions);
    }
  }

  async retraceImage(): Promise<void> {
    const bg = this.design().backgroundImage;
    if (!bg?.src) {
      return;
    }

    this.designService.isTracing.set(true);
    try {
      const blob = await fetch(bg.src).then((r) => r.blob());
      const file = new File([blob], `${this.design().name}.png`, { type: 'image/png' });
      await this.designService.importPng(file, this.traceOptions);
    } catch {
      this.designService.showStatus('No se pudo volver a convertir la imagen');
    } finally {
      this.designService.isTracing.set(false);
    }
  }

  addColor(): void {
    this.designService.addColor(this.newColorName, this.newColorHex);
  }

  readonly isConvertingText = signal(false);
  textConvertData = {
    text: '',
    fontFamily: 'Arial',
    stitchType: 'fill' as StitchType,
  };

  readonly fontOptions = [
    { value: 'Arial', label: 'Arial (Sans-serif limpia)' },
    { value: 'Times New Roman', label: 'Times New Roman (Elegante/Serif)' },
    { value: 'Impact', label: 'Impact (Gruesa/Deportiva)' },
    { value: 'Courier New', label: 'Courier New (Monospaced/Retro)' },
    { value: 'Georgia', label: 'Georgia (Serif clásica)' },
  ];

  initTextConversion(shape: any): void {
    this.textConvertData = {
      text: (shape.text || '').trim(),
      fontFamily: shape.fontFamily || 'Arial',
      stitchType: shape.stitchType || 'fill',
    };
    this.isConvertingText.set(true);
  }

  cancelTextConversion(): void {
    this.isConvertingText.set(false);
  }

  applyTextConversion(shape: any): void {
    if (!this.textConvertData.text.trim()) {
      this.designService.showStatus('Escribe un texto para reemplazar');
      return;
    }

    const newShape = {
      id: crypto.randomUUID(),
      type: 'text' as const,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      colorId: shape.colorId,
      text: this.textConvertData.text,
      fontFamily: this.textConvertData.fontFamily,
      stitchType: this.textConvertData.stitchType,
      label: `Texto: ${this.textConvertData.text}`,
      source: 'manual' as const,
    };

    const updatedShapes = this.design().shapes.filter((s) => s.id !== shape.id);
    updatedShapes.push(newShape);

    this.designService.updateDesign({ shapes: updatedShapes });
    this.designService.selectShape(newShape.id);
    this.isConvertingText.set(false);
    this.designService.showStatus('Región convertida a texto digitalizado');
  }

  moveSelectedShape(direction: 'front' | 'back' | 'forward' | 'backward'): void {
    const shape = this.selectedShape();
    if (!shape) return;

    const shapes = [...this.design().shapes];
    const groupId = shape.groupId;

    if (!groupId) {
      const idx = shapes.findIndex((s) => s.id === shape.id);
      if (idx === -1) return;

      if (direction === 'front') {
        shapes.splice(idx, 1);
        shapes.push(shape);
      } else if (direction === 'back') {
        shapes.splice(idx, 1);
        shapes.unshift(shape);
      } else if (direction === 'forward') {
        if (idx === shapes.length - 1) return;
        shapes[idx] = shapes[idx + 1];
        shapes[idx + 1] = shape;
      } else if (direction === 'backward') {
        if (idx === 0) return;
        shapes[idx] = shapes[idx - 1];
        shapes[idx - 1] = shape;
      }
    } else {
      const groupShapes = shapes.filter((s) => s.groupId === groupId);
      const otherShapes = shapes.filter((s) => s.groupId !== groupId);

      if (direction === 'front') {
        shapes.length = 0;
        shapes.push(...otherShapes, ...groupShapes);
      } else if (direction === 'back') {
        shapes.length = 0;
        shapes.push(...groupShapes, ...otherShapes);
      } else if (direction === 'forward') {
        let lastGroupIdx = -1;
        for (let i = 0; i < shapes.length; i++) {
          if (shapes[i].groupId === groupId) {
            lastGroupIdx = i;
          }
        }
        if (lastGroupIdx === -1 || lastGroupIdx === shapes.length - 1) return;

        const nextShape = shapes[lastGroupIdx + 1];
        const filtered = shapes.filter(s => s.groupId !== groupId);
        const insertIdx = filtered.findIndex(s => s.id === nextShape.id);
        filtered.splice(insertIdx + 1, 0, ...groupShapes);
        
        shapes.length = 0;
        shapes.push(...filtered);
      } else if (direction === 'backward') {
        let firstGroupIdx = -1;
        for (let i = 0; i < shapes.length; i++) {
          if (shapes[i].groupId === groupId) {
            firstGroupIdx = i;
            break;
          }
        }
        if (firstGroupIdx === -1 || firstGroupIdx === 0) return;

        const prevShape = shapes[firstGroupIdx - 1];
        const filtered = shapes.filter(s => s.groupId !== groupId);
        const insertIdx = filtered.findIndex(s => s.id === prevShape.id);
        filtered.splice(insertIdx, 0, ...groupShapes);

        shapes.length = 0;
        shapes.push(...filtered);
      }
    }

    this.designService.updateDesign({ shapes });
    this.designService.showStatus('Orden de capas del grupo actualizado');
  }
}
