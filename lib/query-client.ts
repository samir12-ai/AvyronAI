import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthToken } from "./secure-token-storage";

// P0-3 (launch-closure Wave 1): JWT now read from expo-secure-store
// (hardware-backed Keychain/Keystore). The legacy AsyncStorage key
// `avyron_auth_token` is auto-migrated on first read and then deleted.
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getAuthToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
  } catch {}
  return {};
}

export async function authFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const existingHeaders = (init?.headers as Record<string, string>) || {};
  return fetch(typeof input === 'object' && 'toString' in input ? input.toString() : input as string, {
    ...init,
    headers: {
      ...authHeaders,
      ...existingHeaders,
    },
  });
}

export function getApiUrl(path?: string): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }

  const base = `https://${host}`;

  if (path) {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  return base;
}

export async function safeApiJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text || !text.trim()) {
    throw new Error(`Server returned an empty response (status ${res.status})`);
  }
  if (text.trimStart().startsWith("<")) {
    if (res.status === 404) {
      throw new Error("API endpoint not found (404). Please restart the app.");
    }
    if (res.status >= 500) {
      throw new Error("Server error. Please try again in a moment.");
    }
    throw new Error("Server returned an unexpected response. Check your connection and try again.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Unable to parse server response. Please try again.");
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const url = getApiUrl(route);
  const authHeaders = await getAuthHeaders();

  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = getApiUrl(queryKey.join("/") as string);
    const authHeaders = await getAuthHeaders();

    const res = await fetch(url, {
      headers: authHeaders,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await safeApiJson(res);
  };

// P1-7 (launch-closure W3): bound staleTime to 5 minutes. The previous
// `Infinity` default relied entirely on manual invalidation — any missing
// invalidation call left users staring at stale dashboard metrics with no
// hint that the data had aged. 5 minutes matches the 5-min autonomous worker
// tick so the dashboard cannot lag the engine state by more than one cycle.
const DEFAULT_STALE_TIME_MS = 5 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: DEFAULT_STALE_TIME_MS,
      retry: false,
    },
    mutations: {
      retry: false,
      // P1-7 (launch-closure W3): surface mutation failures in the console so
      // silent write failures (network drops, server 5xx, expired tokens) are
      // visible during dev/QA. UI components remain free to attach their own
      // onError for user-facing toasts; this is the floor.
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[ReactQuery] mutation error: ${message}`);
      },
    },
  },
});
