import { Injectable } from '@angular/core';
import { writeDstFile } from '../core/embroidery/dst-writer';
import { downloadBlob, writeJefFile } from '../core/embroidery/jef-writer';
import { countColorChanges, countDesignStitches, generatePatternStitches } from '../core/embroidery/stitch-generator';
import { EmbroideryDesign, StitchPoint } from '../models/embroidery.model';

export type ExportFormat = 'jef' | 'dst' | 'bord' | 'png' | 'jpg';

@Injectable({ providedIn: 'root' })
export class ExportService {
  generateStitches(design: EmbroideryDesign): StitchPoint[] {
    return generatePatternStitches(design);
  }

  exportDesign(design: EmbroideryDesign, format: ExportFormat): void {
    const safeName = design.name.trim().replace(/[^\w\- ]+/g, '') || 'diseno';

    if (format === 'bord') {
      const json = JSON.stringify(design, null, 2);
      downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName}.bord.json`);
      return;
    }

    const stitches = this.generateStitches(design);
    if (stitches.length === 0) {
      alert('El diseño no tiene puntadas para exportar. Agrega al menos una forma.');
      return;
    }

    if (format === 'jef') {
      const usedColors = design.colors.filter(c => design.shapes.some(s => s.colorId === c.id));
      downloadBlob(writeJefFile(stitches, usedColors, design.name), `${safeName}.jef`);
      return;
    }

    downloadBlob(writeDstFile(stitches, design.name), `${safeName}.dst`);
  }

  importProjectFile(file: File): Promise<EmbroideryDesign> {
    return file.text().then((text) => {
      const parsed = JSON.parse(text) as EmbroideryDesign;
      if (!parsed.name || !Array.isArray(parsed.shapes) || !Array.isArray(parsed.colors)) {
        throw new Error('Archivo de proyecto inválido');
      }
      return parsed;
    });
  }

  getDesignStats(design: EmbroideryDesign): { stitches: number; colorBlocks: number } {
    const stitches = this.generateStitches(design);
    return {
      stitches: countDesignStitches(design),
      colorBlocks: countColorChanges(stitches),
    };
  }
}
