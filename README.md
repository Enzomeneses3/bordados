# Bordadoras App

Mini proyecto Angular para crear diseños de bordado orientados a **máquinas Janome** y exportarlos en formatos compatibles con **Artistic Digitizer Full 2.0**.

## Qué hace

- Editor visual con lienzo (canvas) para formas básicas: rectángulo, elipse, línea y texto
- Gestión de colores de hilo con mapeo a la paleta **JEF** de Janome
- Tipos de puntada: relleno, satinado y contorno
- Vista previa de puntadas en el lienzo
- Exportación:
  - **`.jef`** — formato nativo Janome (recomendado)
  - **`.dst`** — formato universal importable en Artistic Digitizer
  - **`.bord.json`** — proyecto editable interno (similar en concepto al `.draw` de Artistic Digitizer, pero abierto)

## Compatibilidad con Artistic Digitizer

Artistic Digitizer Full 2.0 guarda proyectos en **`.draw`** (formato propietario cerrado). Este proyecto **no genera `.draw`**, pero sí exporta **`.jef`** y **`.dst`**, que Artistic Digitizer puede **importar** directamente (`Archivo > Importar` o arrastrar al workspace).

Flujo recomendado:

1. Crear el diseño en esta app
2. Exportar como **JEF** o **DST**
3. Abrir/importar el archivo en Artistic Digitizer Full 2.0
4. Ajustar, simular y enviar a la máquina Janome

## Requisitos

- Node.js 18+
- npm

## Instalación y ejecución

```bash
cd bordadoras-app
npm install
npm start
```

Abrir `http://localhost:4200`

## Build de producción

```bash
npm run build
```

## Estructura principal

```
src/app/
├── core/embroidery/     # Generador de puntadas, writers JEF/DST
├── core/constants/      # Paleta de colores JEF
├── components/          # Lienzo de diseño
├── pages/designer/      # UI principal
├── services/            # Estado del diseño y exportación
└── models/              # Tipos del dominio
```

## Notas técnicas

- Las unidades internas son **0.1 mm** (estándar de bordado)
- El writer JEF está basado en la especificación pública y en `pyembroidery`
- Es un **mini proyecto** de demostración; no reemplaza software profesional de digitizado
