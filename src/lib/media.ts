import { useSyncExternalStore } from 'react'

// Below this width .plots lays the cards one per row whatever the setting
// (index.css carries the same number), so the graphs-per-row control hides.
export const NARROW = '(max-width: 900px)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => { const mq = matchMedia(query); mq.addEventListener('change', notify); return () => mq.removeEventListener('change', notify) },
    () => matchMedia(query).matches,
    () => false,
  )
}

export const useNarrow = () => useMediaQuery(NARROW)
