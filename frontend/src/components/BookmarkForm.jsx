import { useState } from 'react';

// 契约 §6：字段 url / title / description / tags（逗号分隔输入，提交时转数组）
export default function BookmarkForm({ initial, onSubmit, onCancel }) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const payload = {
      url: url.trim(),
      title: title.trim(),
      description,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err.message || '保存失败');
      setSubmitting(false);
    }
  }

  return (
    <form className="bookmark-form" onSubmit={handleSubmit}>
      {error && <div className="alert">{error}</div>}
      <label>
        URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="https://example.com"
        />
      </label>
      <label>
        标题
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={255}
          placeholder="书签标题"
        />
      </label>
      <label>
        描述
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="可选"
        />
      </label>
      <label>
        标签
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="逗号分隔，如：work, reading"
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? '保存中…' : '保存'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
