/**
 * Secure token storage — Launch-Closure Wave 1 (P0-3) seal.
 *
 * Pre-seal state (master audit P0-3): the JWT was stored in plain
 * AsyncStorage under `avyron_auth_token`. AsyncStorage is unencrypted on
 * disk (iOS Documents, Android shared_prefs) — any malware, backup
 * extraction, or shared-device attacker could read every authed user's JWT
 * and impersonate them for the full 14-day token lifetime.
 *
 * Seal: tokens now live in expo-secure-store (Keychain on iOS, EncryptedSharedPreferences
 * on Android, browser localStorage with prefix on web). On first run after
 * the upgrade, any token still in AsyncStorage is migrated into SecureStore
 * and then deleted from AsyncStorage so the legacy key never holds a JWT
 * again.
 *
 * Key behaviours:
 *   - getAuthToken(): reads SecureStore; on miss, falls back to AsyncStorage
 *     ONCE, migrates it, then returns the value.
 *   - setAuthToken(token): writes SecureStore; deletes any AsyncStorage copy.
 *   - clearAuthToken(): wipes BOTH SecureStore AND AsyncStorage so logout
 *     can't leave a cached token behind on any backend.
 *
 * Web fallback: SecureStore.isAvailableAsync() returns false on web. We fall
 * back to localStorage with the same key — the browser equivalent of "best
 * available"; a hardware-backed keystore is not reachable from a web app.
 */
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// SecureStore key constraints: alphanumeric + ._- only, no colons.
const SECURE_TOKEN_KEY = "avyron_auth_token_secure_v1";
// Legacy AsyncStorage keys we migrate FROM (and then erase).
const LEGACY_ASYNC_TOKEN_KEY = "avyron_auth_token";
// Web localStorage key. The browser has no Keychain; localStorage is the only
// persistent surface available to a web SPA. We intentionally bypass
// expo-secure-store on web because its localStorage shim has thrown silently
// in our environment, leaving users with `401 Authentication required` on
// every request after login.
const WEB_TOKEN_KEY = "avyron_auth_token_web_v1";

const isWeb = Platform.OS === "web";
const webStorage: Storage | null =
  isWeb && typeof window !== "undefined" && typeof window.localStorage !== "undefined"
    ? window.localStorage
    : null;

// In-memory cache. Survives within the JS runtime (including across HMR
// hot-reloads on web) and shields the request layer from any persistent-
// storage hiccup. AuthContext keeps this in lockstep with React state via
// `setAuthToken` / `clearAuthToken`.
let cachedToken: string | null = null;

let nativeSecureStoreAvailable: boolean | null = null;
async function isNativeSecureStoreUsable(): Promise<boolean> {
  if (isWeb) return false;
  if (nativeSecureStoreAvailable !== null) return nativeSecureStoreAvailable;
  try {
    nativeSecureStoreAvailable = await SecureStore.isAvailableAsync();
  } catch {
    nativeSecureStoreAvailable = false;
  }
  return nativeSecureStoreAvailable!;
}

/** Read JWT. Migrates from legacy AsyncStorage key on first read. */
export async function getAuthToken(): Promise<string | null> {
  // In-memory cache wins: it is the source-of-truth for the live session and
  // bridges any window where persisted storage is empty (e.g. immediately
  // after a fresh login on web while localStorage write is still settling, or
  // during an HMR reload where storage was previously broken).
  if (cachedToken) return cachedToken;
  if (isWeb) {
    if (webStorage) {
      try {
        const t = webStorage.getItem(WEB_TOKEN_KEY);
        if (t) return t;
      } catch (e) {
        console.warn("[SecureTokenStorage] localStorage.getItem failed:", e);
      }
      // Legacy migration on web — pre-fix tokens may have been written to the
      // expo-secure-store web shim, which also keys into localStorage.
      try {
        const legacyWeb = webStorage.getItem(SECURE_TOKEN_KEY);
        if (legacyWeb) {
          try { webStorage.setItem(WEB_TOKEN_KEY, legacyWeb); } catch {}
          try { webStorage.removeItem(SECURE_TOKEN_KEY); } catch {}
          return legacyWeb;
        }
      } catch {}
    }
    return null;
  }

  const usable = await isNativeSecureStoreUsable();
  if (usable) {
    try {
      const t = await SecureStore.getItemAsync(SECURE_TOKEN_KEY);
      if (t) return t;
    } catch {
      // fall through to legacy migration
    }
  }
  // One-shot migration from the unencrypted legacy key (native only).
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_ASYNC_TOKEN_KEY);
    if (legacy) {
      if (usable) {
        try { await SecureStore.setItemAsync(SECURE_TOKEN_KEY, legacy); } catch {}
      }
      try { await AsyncStorage.removeItem(LEGACY_ASYNC_TOKEN_KEY); } catch {}
      return legacy;
    }
  } catch {}
  return null;
}

/** Persist JWT. Always wipes the legacy AsyncStorage copy. */
export async function setAuthToken(token: string): Promise<void> {
  cachedToken = token;
  if (isWeb) {
    if (webStorage) {
      try {
        webStorage.setItem(WEB_TOKEN_KEY, token);
      } catch (e) {
        console.warn("[SecureTokenStorage] localStorage.setItem failed; token kept in memory only:", e);
      }
    } else {
      console.warn("[SecureTokenStorage] localStorage unavailable; token kept in memory only.");
    }
    return;
  }

  const usable = await isNativeSecureStoreUsable();
  if (usable) {
    try {
      await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
    } catch (e) {
      console.warn("[SecureTokenStorage] SecureStore.setItem failed; token NOT persisted:", e);
    }
  } else {
    // Last-resort fallback: never silently downgrade to AsyncStorage. Refuse
    // to persist rather than write JWT in the clear. The session will still
    // work for the lifetime of the React state.
    console.warn("[SecureTokenStorage] SecureStore unavailable; token kept in memory only.");
  }
  try { await AsyncStorage.removeItem(LEGACY_ASYNC_TOKEN_KEY); } catch {}
}

/** Wipe JWT from every backend. */
export async function clearAuthToken(): Promise<void> {
  cachedToken = null;
  if (isWeb) {
    if (webStorage) {
      try { webStorage.removeItem(WEB_TOKEN_KEY); } catch {}
      try { webStorage.removeItem(SECURE_TOKEN_KEY); } catch {}
    }
    return;
  }
  const usable = await isNativeSecureStoreUsable();
  if (usable) {
    try { await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY); } catch {}
  }
  try { await AsyncStorage.removeItem(LEGACY_ASYNC_TOKEN_KEY); } catch {}
}
