// What a variable is called on the graphs. The internal names (the keys of
// VARIABLES, and 'col:<short>' for a raw channel) never change, so settings
// and saved sessions stay valid; the label shown can be typed over.
export const DEFAULT_LABELS: Record<string, string> = {
  'Beam Transmission': 'Transmissivity',
}

export function labelFor(name: string, custom: Record<string, string>, fallback?: string): string {
  return custom[name]?.trim() || DEFAULT_LABELS[name] || fallback || name
}
