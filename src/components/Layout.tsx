import { useEffect } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { useStore, effectiveTheme } from '../store'

export default function Layout() {
  const count = useStore(s => s.stations.length)
  const active = useStore(s => s.stations.filter(x => x.active).length)
  const theme = useStore(s => s.settings.theme)
  const setSettings = useStore(s => s.setSettings)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
  }, [theme])
  // Following the system: when it flips, the graphs follow too.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const follow = () => { const t = effectiveTheme('system'); setSettings({ profileGraphTheme: t, sectionGraphTheme: t }) }
    mq.addEventListener('change', follow)
    return () => mq.removeEventListener('change', follow)
  }, [theme, setSettings])
  const dark = effectiveTheme(theme) === 'dark'
  // Switching the site switches the graphs with it; each page's own switch
  // can then set its graphs the other way.
  const toggle = () => { const next = dark ? 'light' : 'dark'; setSettings({ theme: next, profileGraphTheme: next, sectionGraphTheme: next }) }
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="CTD Grapher home">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 12c3-4 5 4 8 0s5 4 8 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M3 17c3-4 5 4 8 0s5 4 8 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5"/><circle cx="11" cy="5" r="2" fill="currentColor"/></svg>
          <span>CTD Grapher</span>
        </Link>
        <nav aria-label="Main">
          <NavLink to="/" end>Stations{count ? <span className="badge">{active}/{count}</span> : null}</NavLink>
          <NavLink to="/profiles">Profiles</NavLink>
          <NavLink to="/transect">Transect</NavLink>
          <button className="theme" onClick={toggle} title={dark ? 'Switch the site and graphs to light' : 'Switch the site and graphs to dark'} aria-label="Toggle light and dark">
            {dark
              ? <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><g stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/></svg>}
          </button>
        </nav>
      </header>
      <main className="content"><Outlet /></main>
      <footer className="foot"><Link to="/about">About</Link> · <Link to="/feedback">Feedback</Link></footer>
    </div>
  )
}
