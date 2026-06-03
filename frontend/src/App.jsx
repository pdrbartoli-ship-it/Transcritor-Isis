import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Auth from './pages/Auth'
import Layout from './components/Layout'
import Home from './pages/Home'
import FolderView from './pages/FolderView'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  return user ? children : <Navigate to="/auth" replace />
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  return user ? <Navigate to="/" replace /> : children
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Home />} />
            <Route path="/folders/:folderId" element={<FolderView />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
