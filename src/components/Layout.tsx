import { NavLink, Outlet, Link } from 'react-router-dom'
import { useStore } from '../store'

export default function Layout() {
  const count = useStore(s => s.stations.length)
  const active = useStore(s => s.stations.filter(x => x.active).length)
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
        </nav>
      </header>
      <main className="content"><Outlet /></main>
      <footer className="foot"><Link to="/about">About</Link></footer>
    </div>
  )
}
