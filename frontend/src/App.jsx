import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { getToken, setOnUnauthorized } from './api.js';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Bookmarks from './pages/Bookmarks.jsx';

// 契约 §6：未登录访问 / 直接重定向 /login
function ProtectedRoute({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const navigate = useNavigate();

  // 把 401 时的重定向交给路由（SPA 内跳转，无需整页刷新）
  useEffect(() => {
    setOnUnauthorized(() => navigate('/login', { replace: true }));
  }, [navigate]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Bookmarks />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
