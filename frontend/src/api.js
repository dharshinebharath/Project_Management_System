const API_URL = import.meta.env.VITE_API_URL || '/api'

export async function api(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  if (options.body instanceof FormData) {
    // Let the browser set the multipart boundary.
  } else if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach the Novac API. Start the backend and try again. (${error.message})`, { cause: error })
    }
    throw error
  }
  if (!response.ok) {
    const message = (await response.text()) || `Request failed (${response.status})`
    throw new Error(message)
  }
  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

export function jsonBody(value) {
  return JSON.stringify(value)
}
