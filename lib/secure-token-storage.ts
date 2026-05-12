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

let secureStoreAvailable: boolean | null = null;
async function isSecureStoreUsable(): Promise<boolean> {
  if (secureStoreAvailable !== null) return secureStoreAvailable;
  if (Platform.OS === "web") {
    // expo-secure-store on web is a thin localStorage shim. Treat as
    // available so we use one consistent code path; web cannot offer a
    // hardware-backed alternative anyway.
    secureStoreAvailable = true;
    return true;
  }
  try {
    secureStoreAvailable = await SecureStore.isAvailableAsync();
  } catch {
    secureStoreAvailable = false;
  }
  return secureStoreAvailable!;
}

/** Read JWT. Migrates from legacy AsyncStorage key on first read. */
export async function getAuthToken(): Promise<string | null> {
  const usable = await isSecureStoreUsable();
  if (usable) {
    try {
      const t = await SecureStore.getItemAsync(SECURE_TOKEN_KEY);
      if (t) return t;
    } catch {
      // fall through to legacy migration
    }
  }
  // One-shot migration from the unencrypted legacy key.
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
  const usable = await isSecureStoreUsable();
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
  const usable = await isSecureStoreUsable();
  if (usable) {
    try { await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY); } catch {}
  }
  try { await AsyncStorage.removeItem(LEGACY_ASYNC_TOKEN_KEY); } catch {}
}
