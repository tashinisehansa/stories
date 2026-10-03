// Small fetch wrapper. Errors carry a child-friendly `message` from the server.
export class ApiError extends Error {
  constructor(message, { status, code, details, offline } = {}) {
    super(message);
    Object.assign(this, { status, code, details, offline });
  }
}

export async function api(method, url, body, { keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError("We can't reach the story studio right now. Your writing is safe on this device.", { offline: true });
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const e = data.error ?? {};
    throw new ApiError(e.message ?? 'Something went wrong. Your writing is safe. Please try again.', {
      status: res.status,
      code: e.code,
      details: e.details,
    });
  }
  return data;
}

export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}, opts) => api('PUT', u, b, opts);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u);
