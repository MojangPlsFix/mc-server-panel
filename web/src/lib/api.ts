export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fired when the server answers 401, so the app can return to the login screen. */
export const UNAUTHORIZED_EVENT = "panel:unauthorized";

export async function api<T = void>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
  });
  if (response.status === 401 && path !== "/api/auth/login") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!response.ok) {
    let message = response.statusText || `Request failed (${response.status})`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // not JSON
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204 || response.status === 202) {
    return (
      response.headers.get("content-type")?.includes("json") ? response.json() : undefined
    ) as Promise<T>;
  }
  return response.json() as Promise<T>;
}
