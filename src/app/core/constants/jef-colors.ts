export interface JefThread {
  index: number;
  name: string;
  r: number;
  g: number;
  b: number;
}

export const JEF_THREAD_PALETTE: JefThread[] = [
  { index: 0, name: 'Unknown', r: 0, g: 0, b: 0 },
  { index: 1, name: 'Negro', r: 0, g: 0, b: 0 },
  { index: 2, name: 'Blanco', r: 255, g: 255, b: 255 },
  { index: 3, name: 'Girasol', r: 255, g: 255, b: 23 },
  { index: 4, name: 'Avellana', r: 250, g: 160, b: 96 },
  { index: 5, name: 'Verde oliva', r: 92, g: 118, b: 73 },
  { index: 6, name: 'Verde', r: 64, g: 192, b: 48 },
  { index: 7, name: 'Cielo', r: 101, g: 194, b: 200 },
  { index: 8, name: 'Púrpura', r: 172, g: 128, b: 190 },
  { index: 9, name: 'Rosa', r: 245, g: 188, b: 203 },
  { index: 10, name: 'Rojo', r: 255, g: 0, b: 0 },
  { index: 11, name: 'Marrón', r: 192, g: 128, b: 0 },
  { index: 12, name: 'Azul', r: 0, g: 0, b: 240 },
  { index: 13, name: 'Dorado', r: 228, g: 195, b: 93 },
  { index: 14, name: 'Marrón oscuro', r: 165, g: 42, b: 42 },
  { index: 15, name: 'Violeta pálido', r: 213, g: 176, b: 212 },
  { index: 16, name: 'Amarillo pálido', r: 252, g: 242, b: 148 },
  { index: 17, name: 'Rosa pálido', r: 240, g: 208, b: 192 },
  { index: 18, name: 'Melocotón', r: 255, g: 192, b: 0 },
  { index: 19, name: 'Beige', r: 201, g: 164, b: 128 },
  { index: 20, name: 'Vino', r: 155, g: 61, b: 75 },
  { index: 21, name: 'Cielo pálido', r: 160, g: 184, b: 204 },
  { index: 22, name: 'Verde amarillo', r: 127, g: 194, b: 28 },
  { index: 23, name: 'Gris plata', r: 185, g: 185, b: 185 },
  { index: 24, name: 'Gris', r: 160, g: 160, b: 160 },
  { index: 25, name: 'Aqua pálido', r: 152, g: 214, b: 189 },
  { index: 26, name: 'Azul bebé', r: 184, g: 240, b: 240 },
  { index: 27, name: 'Azul polvo', r: 54, g: 139, b: 160 },
  { index: 28, name: 'Azul brillante', r: 79, g: 131, b: 171 },
  { index: 29, name: 'Azul pizarra', r: 56, g: 106, b: 145 },
  { index: 30, name: 'Azul marino', r: 0, g: 32, b: 107 },
];

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function findNearestJefIndex(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  let bestIndex = 1;
  let bestDistance = Number.MAX_VALUE;

  for (const thread of JEF_THREAD_PALETTE) {
    if (thread.index === 0) {
      continue;
    }
    const distance = (r - thread.r) ** 2 + (g - thread.g) ** 2 + (b - thread.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = thread.index;
    }
  }

  return bestIndex;
}
