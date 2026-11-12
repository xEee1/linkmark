// 契约 §6：baseURL '/api'，自动带 Bearer，统一解析 JSON，非 2xx 抛错；
// 任意受保护接口返回 401 → 清 token → 跳 /login。
const TOKEN_KEY = 'linkmark_token';
const BASE = '/api';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// App 注入 SPA 内的重定向逻辑；未注入时退化为整页跳转。
let onUnauthorized = null;
export function setOnUnauthorized(handler) {
  onUnauthorized = handler;
}

function handleUnauthorized() {
  clearToken();
  if (onUnauthorized) {
    onUnauthorized();
  } else if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

async function request(path, { method = 'GET', body, publicEndpoint = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('网络错误，请稍后重试');
  }

  // 登录 / 注册本身的 401 是凭据错误（INVALID_CREDENTIALS），不当作会话过期处理。
  if (response.status === 401 && !publicEndpoint) {
    handleUnauthorized();
  }

  let data = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
  }

  if (!response.ok) {
    const message =
      (data && data.error && data.error.message) || `请求失败（${response.status}）`;
    const err = new Error(message);
    err.status = response.status;
    err.code = data && data.error ? data.error.code : undefined;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  // 认证
  register: (payload) =>
    request('/auth/register', { method: 'POST', body: payload, publicEndpoint: true }),
  login: (payload) =>
    request('/auth/login', { method: 'POST', body: payload, publicEndpoint: true }),
  me: () => request('/auth/me'),

  // 书签
  listBookmarks: ({ q, tag } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    const qs = params.toString();
    return request(`/bookmarks${qs ? `?${qs}` : ''}`);
  },
  getBookmark: (id) => request(`/bookmarks/${encodeURIComponent(id)}`),
  createBookmark: (payload) => request('/bookmarks', { method: 'POST', body: payload }),
  updateBookmark: (id, payload) =>
    request(`/bookmarks/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
  deleteBookmark: (id) =>
    request(`/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // 标签
  listTags: () => request('/tags'),
};
