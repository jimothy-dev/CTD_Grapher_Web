// What a variable is called on the graphs. The internal names (the keys of
// VARIABLES, and 'col:<short>' for a raw channel) never change, so settings
// and saved sessions stay valid; the label shown can be typed over.
export const DEFAULT_LABELS: Record<string, string> = {
  'Beam Transmission': 'Transmissivity',
}

export function labelFor(name: string, custom: Record<string, string>, fallback?: string): string {
  return custom[name]?.trim() || DEFAULT_LABELS[name] || fallback || name
}

// A unit typed by hand, which replaces what the files say wherever that unit
// is shown. It renames the unit; it never converts the values, so casts that
// really are in different units are still reported under the graph.
export function unitsFor(name: string, custom: Record<string, string>, fromFile: string): string {
  return custom[name]?.trim() || fromFile
}
