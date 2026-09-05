import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Stations from './pages/Stations'
import Profiles from './pages/Profiles'
import Transect from './pages/Transect'
import About from './pages/About'
import Feedback from './pages/Feedback'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Stations />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="transect" element={<Transect />} />
          <Route path="about" element={<About />} />
          <Route path="feedback" element={<Feedback />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
