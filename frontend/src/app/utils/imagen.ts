// Comprime y redimensiona una imagen elegida por el cliente ANTES de subirla.
// Las fotos del portal se guardan como data URL base64 en la BD (patrón del proyecto),
// así que una foto cruda de celular (3-8 MB) inflaría la base: la reducimos a un
// lado máximo y la recodificamos a JPEG de calidad media → típicamente 40-150 KB.

export interface OpcionesImagen {
  maxLado?: number;   // lado más largo permitido (px)
  calidad?: number;   // 0..1 calidad JPEG
}

// Tamaño máximo del archivo de origen que aceptamos abrir (evita procesar archivos enormes).
const MAX_ARCHIVO_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Devuelve un data URL JPEG comprimido. Lanza Error con mensaje legible si el
 * archivo no es una imagen válida o supera el tope.
 */
export async function comprimirImagen(file: File, opts: OpcionesImagen = {}): Promise<string> {
  const maxLado = opts.maxLado ?? 800;
  const calidad = opts.calidad ?? 0.82;

  if (!file || !file.type.startsWith('image/')) {
    throw new Error('El archivo debe ser una imagen (JPG o PNG).');
  }
  if (file.size > MAX_ARCHIVO_BYTES) {
    throw new Error('La imagen es demasiado grande (máx. 15 MB).');
  }

  const origen = await leerComoDataURL(file);
  const img = await cargarImagen(origen);

  let { width, height } = img;
  if (width > maxLado || height > maxLado) {
    const escala = maxLado / Math.max(width, height);
    width = Math.round(width * escala);
    height = Math.round(height * escala);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen.');
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', calidad);
}

function leerComoDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function cargarImagen(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
    img.src = dataUrl;
  });
}
