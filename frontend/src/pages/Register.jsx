import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { api, setToken, getToken } from '../api.js';

export default function Register() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
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
      // 契约：POST /api/auth/register → { token, user }
      const data = await api.register({ username, email, password });
      setToken(data.token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || '注册失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>linkmark</h1>
        <p className="muted">创建账号，开始收藏链接</p>
        {error && <div className="alert">{error}</div>}
        <label>
          用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={32}
            placeholder="3-32 位字母数字下划线"
          />
        </label>
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
            minLength={8}
            placeholder="至少 8 位"
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? '注册中…' : '注册'}
        </button>
        <p className="muted">
          已有账号？<Link to="/login">去登录</Link>
        </p>
      </form>
    </div>
  );
}
