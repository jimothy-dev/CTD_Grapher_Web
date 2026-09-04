// Colour palette files a user can upload for the sections. Surfer .clr is the
// reference; more formats are added as they are documented (see parsePalette).
import { parseClr, type Clr } from './colors'

export const PALETTE_EXTENSIONS = ['.clr']

export function parsePalette(text: string, filename: string): Clr {
  const ext = (filename.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
  if (ext === '.clr' || /^\s*ColorMap/i.test(text)) return parseClr(text)
  throw new Error(`${filename}: not a palette format this app reads (${PALETTE_EXTENSIONS.join(', ')})`)
}
