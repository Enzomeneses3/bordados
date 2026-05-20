import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  effect,
  inject,
  input,
} from '@angular/core';
import { generatePatternStitches } from '../../core/embroidery/stitch-generator';
import {
  CanvasViewMode,
  COMMAND_MASK,
  DesignShape,
  EmbroideryDesign,
  HOOP_DIMENSIONS,
  STITCH_COMMAND,
} from '../../models/embroidery.model';
import { DesignService } from '../../services/design.service';

@Component({
  selector: 'app-design-canvas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './design-canvas.component.html',
  styleUrl: './design-canvas.component.scss',
})
export class DesignCanvasComponent implements AfterViewInit {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  design = input.required<EmbroideryDesign>();
  selectedShapeId = input<string | null>(null);
  viewMode = input<CanvasViewMode>('both');

  private readonly designService = inject(DesignService);
  private ctx!: CanvasRenderingContext2D;
  private scale = 0.45;
  private offsetX = 0;
  private offsetY = 0;
  private draggingShapeId: string | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private backgroundCache = new Map<string, HTMLImageElement>();
  private renderToken = 0;
  private renderQueued = false;
  private renderRunning = false;
  private renderAgain = false;
  private hasCommittedDrag = false;

  constructor() {
    effect(() => {
      this.design();
      this.selectedShapeId();
      this.viewMode();
      this.scheduleRender();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.scheduleRender();
  }

  onPointerDown(event: MouseEvent): void {
    const point = this.toDesignCoords(event);
    const hit = [...this.design().shapes].reverse().find((shape) => this.hitTest(shape, point.x, point.y));
    if (!hit) {
      this.designService.selectShape(null);
      return;
    }
    this.designService.selectShape(hit.id);
    this.draggingShapeId = hit.id;
    this.dragOffsetX = hit.x - point.x;
    this.dragOffsetY = hit.y - point.y;
    this.hasCommittedDrag = false;
  }

  onPointerMove(event: MouseEvent): void {
    if (!this.draggingShapeId) {
      return;
    }
    if (!this.hasCommittedDrag) {
      this.designService.commitHistoryState(false);
      this.hasCommittedDrag = true;
    }
    const point = this.toDesignCoords(event);
    this.designService.updateShape(this.draggingShapeId, {
      x: point.x + this.dragOffsetX,
      y: point.y + this.dragOffsetY,
    });
  }

  onPointerUp(): void {
    this.draggingShapeId = null;
    this.hasCommittedDrag = false;
  }

  zoomIn(): void {
    this.scale = Math.min(2.5, this.scale * 1.15);
    this.scheduleRender();
  }

  zoomOut(): void {
    this.scale = Math.max(0.15, this.scale * 0.87);
    this.scheduleRender();
  }

  resetZoom(): void {
    this.scale = 0.45;
    this.scheduleRender();
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.92 : 1.08;
    this.scale = Math.min(2.5, Math.max(0.15, this.scale * delta));
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderQueued) {
      this.renderAgain = true;
      return;
    }
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      void this.runRenderPass();
    });
  }

  private async runRenderPass(): Promise<void> {
    if (this.renderRunning) {
      this.renderAgain = true;
      return;
    }
    this.renderRunning = true;
    const token = ++this.renderToken;
    try {
      await this.render(token);
    } finally {
      this.renderRunning = false;
      if (this.renderAgain) {
        this.renderAgain = false;
        this.scheduleRender();
      }
    }
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    this.offsetX = canvas.width / 2;
    this.offsetY = canvas.height / 2;
    this.scheduleRender();
  }

  private toDesignCoords(event: MouseEvent): { x: number; y: number } {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * devicePixelRatio;
    const py = (event.clientY - rect.top) * devicePixelRatio;
    return {
      x: (px - this.offsetX) / this.scale,
      y: (py - this.offsetY) / this.scale,
    };
  }

  private hitTest(shape: DesignShape, x: number, y: number): boolean {
    if (shape.type === 'stitchpath' && shape.points?.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of shape.points) {
        const px = shape.x + point.x;
        const py = shape.y + point.y;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      const padding = 10;
      return x >= minX - padding && x <= maxX + padding && y >= minY - padding && y <= maxY + padding;
    }
    const left = shape.x - shape.width / 2;
    const right = shape.x + shape.width / 2;
    const top = shape.y - shape.height / 2;
    const bottom = shape.y + shape.height / 2;
    return x >= left && x <= right && y >= top && y <= bottom;
  }

  private getBackgroundImage(src: string): Promise<HTMLImageElement> {
    const cached = this.backgroundCache.get(src);
    if (cached) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.backgroundCache.set(src, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  private async render(token: number): Promise<void> {
    if (!this.ctx) {
      return;
    }

    const canvas = this.canvasRef.nativeElement;
    const design = this.design();
    const hoop = HOOP_DIMENSIONS[design.hoopSize];
    const ctx = this.ctx;
    const mode = this.viewMode();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    this.drawGrid(hoop.width, hoop.height);
    this.drawHoop(hoop.width, hoop.height);

    if (design.backgroundImage?.visible && design.backgroundImage.src) {
      try {
        const img = await this.getBackgroundImage(design.backgroundImage.src);
        if (token !== this.renderToken) {
          return;
        }
        ctx.save();
        ctx.globalAlpha = design.backgroundImage.opacity;
        ctx.drawImage(
          img,
          design.backgroundImage.x - design.backgroundImage.width / 2,
          design.backgroundImage.y - design.backgroundImage.height / 2,
          design.backgroundImage.width,
          design.backgroundImage.height,
        );
        ctx.restore();
      } catch {
        // ignore broken image
      }
    }

    if (token !== this.renderToken) {
      return;
    }

    if (mode === 'design' || mode === 'both') {
      for (const shape of design.shapes) {
        this.drawShape(shape, shape.id === this.selectedShapeId());
      }
    }

    if (mode === 'stitch' || mode === 'both') {
      this.drawStitchPreview(design, mode === 'both');
    }

    if (token === this.renderToken) {
      ctx.restore();
    }
  }

  private drawGrid(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1 / this.scale;
    const step = 100;
    for (let x = -width / 2; x <= width / 2; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, -height / 2);
      ctx.lineTo(x, height / 2);
      ctx.stroke();
    }
    for (let y = -height / 2; y <= height / 2; y += step) {
      ctx.beginPath();
      ctx.moveTo(-width / 2, y);
      ctx.lineTo(width / 2, y);
      ctx.stroke();
    }
  }

  private drawHoop(width: number, height: number): void {
    const ctx = this.ctx;
    
    // Check bounds
    let outOfBounds = false;
    for (const shape of this.design().shapes) {
      if (shape.type === 'stitchpath' && shape.points) {
        for (const pt of shape.points) {
          const px = shape.x + pt.x;
          const py = shape.y + pt.y;
          if (px < -width/2 || px > width/2 || py < -height/2 || py > height/2) {
            outOfBounds = true;
            break;
          }
        }
      } else {
        const left = shape.x - shape.width / 2;
        const right = shape.x + shape.width / 2;
        const top = shape.y - shape.height / 2;
        const bottom = shape.y + shape.height / 2;
        if (left < -width/2 || right > width/2 || top < -height/2 || bottom > height/2) {
          outOfBounds = true;
          break;
        }
      }
      if (outOfBounds) break;
    }

    ctx.strokeStyle = outOfBounds ? '#ef4444' : '#94a3b8';
    ctx.lineWidth = (outOfBounds ? 4 : 2.5) / this.scale;
    ctx.setLineDash([14 / this.scale, 10 / this.scale]);
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.setLineDash([]);
    
    if (outOfBounds) {
      ctx.fillStyle = '#ef4444';
      ctx.font = `bold ${14 / this.scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('DISEÑO FUERA DE LÍMITE', 0, -height / 2 - 10 / this.scale);
    }
  }

  private drawShape(shape: DesignShape, selected: boolean): void {
    const color = this.design().colors.find((item) => item.id === shape.colorId)?.hex ?? '#334155';
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(shape.x, shape.y);
    ctx.rotate((shape.rotation * Math.PI) / 180);

    ctx.fillStyle = `${color}${selected ? '55' : '33'}`;
    ctx.strokeStyle = selected ? '#f97316' : color;
    ctx.lineWidth = (selected ? 3 : 1.8) / this.scale;

    switch (shape.type) {
      case 'rect':
        ctx.fillRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
        ctx.strokeRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(0, 0, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(-shape.width / 2, 0);
        ctx.lineTo(shape.width / 2, 0);
        ctx.stroke();
        break;
      case 'text':
        const fontName = shape.fontFamily || 'Arial';
        ctx.font = `bold ${Math.max(shape.height * 0.8, 14)}px "${fontName}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(shape.text ?? 'TEXTO', 0, 0);
        if (selected) {
          ctx.strokeRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
        }
        break;
      case 'stitchpath':
        if (shape.points && shape.points.length > 1) {
          const jumpSet = new Set(shape.jumps ?? []);
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          for (let i = 1; i < shape.points.length; i++) {
            const point = shape.points[i];
            if (jumpSet.has(i)) {
              ctx.moveTo(point.x, point.y);
            } else {
              ctx.lineTo(point.x, point.y);
            }
          }
          ctx.stroke();
          if (selected) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const point of shape.points) {
              if (point.x < minX) minX = point.x;
              if (point.y < minY) minY = point.y;
              if (point.x > maxX) maxX = point.x;
              if (point.y > maxY) maxY = point.y;
            }
            ctx.setLineDash([6 / this.scale, 4 / this.scale]);
            ctx.strokeStyle = '#f97316';
            ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
            ctx.setLineDash([]);
          }
        }
        break;
    }

    ctx.restore();
  }

  private drawStitchPreview(design: EmbroideryDesign, subtle: boolean): void {
    const stitches = generatePatternStitches(design);
    const usedColors = design.colors.filter(c => design.shapes.some(s => s.colorId === c.id));
    const ctx = this.ctx;
    ctx.lineWidth = (subtle ? 1 : 1.4) / this.scale;
    ctx.globalAlpha = subtle ? 0.85 : 1;

    let colorIndex = 0;
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
    ctx.globalAlpha = 1;
  }
}
