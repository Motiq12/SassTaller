// Validaciones compartidas del frontend.
export const emailValido = (e: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim());
