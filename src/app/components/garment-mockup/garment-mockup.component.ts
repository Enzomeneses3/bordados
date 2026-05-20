import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  effect,
  input,
} from '@angular/core';
import { generatePatternStitches } from '../../core/embroidery/stitch-generator';
import { COMMAND_MASK, EmbroideryDesign, STITCH_COMMAND } from '../../models/embroidery.model';

export type GarmentType = 'tshirt-white' | 'tshirt-black' | 'cap-white' | 'cap-black';

@Component({
  selector: 'app-garment-mockup',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './garment-mockup.component.html',
  styleUrl: './garment-mockup.component.scss',
})
export class GarmentMockupComponent implements AfterViewInit {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  design = input.required<EmbroideryDesign>();
  garmentType = input<GarmentType>('tshirt-white');
  designScale = input<number>(1);

  private ctx!: CanvasRenderingContext2D;
  private customOffsetX = 0;
  private customOffsetY = 0;
  private isDragging = false;
  private lastDragX = 0;
  private lastDragY = 0;

  private backgroundCache = new Map<string, HTMLImageElement>();

  constructor() {
    effect(() => {
      this.design();
      this.garmentType();
      this.designScale();
      requestAnimationFrame(() => this.render());
    });
  }

  ngAfterViewInit(): void {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.render();
  }

  onPointerDown(event: MouseEvent): void {
    this.isDragging = true;
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
  }

  onPointerMove(event: MouseEvent): void {
    if (!this.isDragging) return;
    const dx = event.clientX - this.lastDragX;
    const dy = event.clientY - this.lastDragY;
    
    this.customOffsetX += dx * devicePixelRatio;
    this.customOffsetY += dy * devicePixelRatio;
    
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
    this.render();
  }

  onPointerUp(): void {
    this.isDragging = false;
  }

  private resize(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;
    const w = parent.clientWidth;
    const h = Math.min(parent.clientHeight, Math.round(w * 1.15));
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.render();
  }

  private getGarmentConfig(type: GarmentType) {
    switch (type) {
      case 'tshirt-black':
        return { src: 'assets/mockups/tshirt.png', color: '#1a1a1a' };
      case 'tshirt-white':
        return { src: 'assets/mockups/tshirt.png', color: '#ffffff' };
      case 'cap-black':
        return { src: 'assets/mockups/cap.png', color: '#1a1a1a' };
      case 'cap-white':
        return { src: 'assets/mockups/cap.png', color: '#ffffff' };
    }
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

  private async render(): Promise<void> {
    if (!this.ctx) {
      return;
    }

    const canvas = this.canvasRef.nativeElement;
    const dpr = devicePixelRatio;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const ctx = this.ctx;
    const config = this.getGarmentConfig(this.garmentType());

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#e8eef5');
    gradient.addColorStop(1, '#dbe4ef');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    try {
      const img = await this.getBackgroundImage(config.src);
      const imgAspect = img.width / img.height;
      const canvasAspect = w / h;
      let drawW, drawH;
      if (imgAspect > canvasAspect) {
        drawW = w;
        drawH = w / imgAspect;
      } else {
        drawH = h;
        drawW = h * imgAspect;
      }
      const drawX = (w - drawW) / 2;
      const drawY = (h - drawH) / 2;

      ctx.save();
      // Draw solid color underneath
      ctx.fillStyle = config.color;
      ctx.fillRect(drawX, drawY, drawW, drawH);
      // Draw mockup with multiply mode
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();
    } catch {
      // ignore
    }

    const design = this.design();
    const stitches = generatePatternStitches(design);
    if (stitches.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Carga un diseño para ver el mockup', w / 2, h * 0.5);
      return;
    }

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

    const designW = Math.max(1, maxX - minX);
    const designH = Math.max(1, maxY - minY);
    const cx = w / 2;
    const chestY = h * 0.36;
    const maxChest = w * 0.34 * this.designScale();
    const scale = Math.min(maxChest / designW, maxChest / designH);
    const offsetX = cx - ((minX + maxX) / 2) * scale + this.customOffsetX;
    const offsetY = chestY - ((minY + maxY) / 2) * scale + this.customOffsetY;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Sombra del bordado
    ctx.save();
    ctx.translate(3 / scale, 4 / scale);
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1.8 / scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let colorIndex = 0;
    ctx.beginPath();
    for (const stitch of stitches) {
      if ((stitch.command & COMMAND_MASK) === STITCH_COMMAND.COLOR_CHANGE) {
        colorIndex++;
        ctx.stroke();
        ctx.beginPath();
      }
      if ((stitch.command & COMMAND_MASK) === STITCH_COMMAND.JUMP) {
        ctx.moveTo(stitch.x, stitch.y);
      } else if ((stitch.command & COMMAND_MASK) !== STITCH_COMMAND.END) {
        ctx.lineTo(stitch.x, stitch.y);
      }
    }
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.restore();

    let stitchColorIdx = 0;
    ctx.lineWidth = 1.4 / scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const usedColors = design.colors.filter(c => design.shapes.some(s => s.colorId === c.id));
    for (const stitch of stitches) {
      if ((stitch.command & COMMAND_MASK) === STITCH_COMMAND.COLOR_CHANGE) {
        stitchColorIdx++;
        ctx.stroke();
        ctx.beginPath();
      }
      const color = usedColors[stitchColorIdx]?.hex ?? '#334155';
      ctx.strokeStyle = color;
      if ((stitch.command & COMMAND_MASK) === STITCH_COMMAND.JUMP) {
        ctx.moveTo(stitch.x, stitch.y);
      } else if ((stitch.command & COMMAND_MASK) !== STITCH_COMMAND.END) {
        ctx.lineTo(stitch.x, stitch.y);
      }
    }
    ctx.stroke();

    ctx.restore();

    // Etiqueta mockup
    ctx.fillStyle = '#64748b';
    ctx.font = '11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Vista previa · no reemplaza muestra física', w / 2, h - 16);
  }
}
