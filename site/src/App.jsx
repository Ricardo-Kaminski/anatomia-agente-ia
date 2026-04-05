import { HashRouter, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import Home from './pages/Home.jsx'
import Chapter from './pages/Chapter.jsx'
import Cartografia from './pages/Cartografia.jsx'
import './styles/global.css'

export default function App() {
  return (
    <HashRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/nucleo/:slug" element={<Chapter />} />
        <Route path="/cartografias/:slug" element={<Cartografia />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </HashRouter>
  )
}
