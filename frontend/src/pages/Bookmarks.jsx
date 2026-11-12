import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearToken } from '../api.js';
import BookmarkForm from '../components/BookmarkForm.jsx';

// 契约 §6：列表页 GET /api/bookmarks（q + tag 为 AND）、GET /api/tags；
// 每条书签可编辑 / 删除，「添加书签」按钮；增删改走 POST / PUT / DELETE。
export default function Bookmarks() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [bookmarks, setBookmarks] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  // form: null | { mode: 'create' } | { mode: 'edit', bookmark }
  const [form, setForm] = useState(null);

  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    api.me().then((d) => setUser(d.user)).catch(() => {});
  }, []);

  // 标签列表来自 GET /api/tags，不随筛选变化；增删改后刷新
  useEffect(() => {
    let cancelled = false;
    api
      .listTags()
      .then((d) => {
        if (!cancelled) setTags(d.tags || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // 列表随 q / tag / 数据版本变化；对关键词做轻量防抖
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .listBookmarks({ q: q.trim(), tag })
        .then((d) => {
          if (!cancelled) {
            setBookmarks(d.bookmarks || []);
            setError('');
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, tag, version]);

  function logout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  async function handleCreate(payload) {
    await api.createBookmark(payload);
    setForm(null);
    refresh();
  }

  async function handleUpdate(payload) {
    await api.updateBookmark(form.bookmark.id, payload);
    setForm(null);
    refresh();
  }

  async function handleDelete(id) {
    if (!window.confirm('确定删除这条书签？')) return;
    try {
      await api.deleteBookmark(id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <header className="topbar">
        <div className="brand">linkmark</div>
        <div className="topbar-right">
          {user && <span className="muted">@{user.username}</span>}
          <button className="btn-ghost" onClick={logout}>
            退出登录
          </button>
        </div>
      </header>

      <div className="container">
        <div className="toolbar">
          <input
            className="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题 / URL / 描述…"
          />
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {q && (
            <button className="btn-ghost" onClick={() => setQ('')}>
              清除
            </button>
          )}
          <button className="btn-primary" onClick={() => setForm({ mode: 'create' })}>
            + 添加书签
          </button>
        </div>

        {error && <div className="alert">{error}</div>}

        {loading ? (
          <p className="muted">加载中…</p>
        ) : bookmarks.length === 0 ? (
          <p className="muted">还没有书签，点击「添加书签」新建一条。</p>
        ) : (
          <ul className="bookmark-list">
            {bookmarks.map((b) => (
              <li key={b.id} className="bookmark-item">
                <div className="bookmark-main">
                  <a
                    className="bookmark-title"
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {b.title}
                  </a>
                  <span className="bookmark-url">{b.url}</span>
                  {b.description && <p className="bookmark-desc">{b.description}</p>}
                  <div className="bookmark-tags">
                    {(b.tags || []).map((t) => (
                      <button key={t} className="tag-chip" onClick={() => setTag(t)}>
                        #{t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bookmark-actions">
                  <button
                    className="btn-ghost"
                    onClick={() => setForm({ mode: 'edit', bookmark: b })}
                  >
                    编辑
                  </button>
                  <button className="btn-danger" onClick={() => handleDelete(b.id)}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{form.mode === 'edit' ? '编辑书签' : '添加书签'}</h2>
            <BookmarkForm
              initial={form.bookmark}
              onSubmit={form.mode === 'edit' ? handleUpdate : handleCreate}
              onCancel={() => setForm(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
