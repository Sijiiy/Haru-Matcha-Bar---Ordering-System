import './App.css'
import { lazy, Suspense } from 'react'
import MenuPage from './features/menu/MenuPage.jsx'
import { isStaffPath } from './utils/appPath.js'

const StaffPage = lazy(() => import('./features/staff/StaffPage.jsx'))

function App() {
  return isStaffPath(window.location.pathname)
    ? <Suspense fallback={<main role="status" style={{ padding: 48 }}>Opening the staff workspace…</main>}><StaffPage /></Suspense>
    : <MenuPage />
}

export default App
