import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { api, setToken, getToken } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (getToken()) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // 契约：POST /api/auth/login → { token, user }
      const data = await api.login({ email, password });
      setToken(data.token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>linkmark</h1>
        <p className="muted">登录以管理你的书签</p>
        {error && <div className="alert">{error}</div>}
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="密码"
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? '登录中…' : '登录'}
        </button>
        <p className="muted">
          还没有账号？<Link to="/register">去注册</Link>
        </p>
      </form>
    </div>
  );
}
