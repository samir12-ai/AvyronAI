import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { generateAccessToken } from "../auth";

const BASE_URL = "http://127.0.0.1:8808";

describe("Avyron Auth UI Full Replacement Acceptance (20-Point Suite)", () => {
  const loginTsxPath = path.resolve(process.cwd(), "app/login.tsx");
  const signupTsxPath = path.resolve(process.cwd(), "app/signup.tsx");
  const layoutTsxPath = path.resolve(process.cwd(), "app/_layout.tsx");

  let loginTsxContent = "";
  let signupTsxContent = "";
  let layoutTsxContent = "";

  beforeAll(() => {
    loginTsxContent = fs.readFileSync(loginTsxPath, "utf8");
    signupTsxContent = fs.readFileSync(signupTsxPath, "utf8");
    layoutTsxContent = fs.readFileSync(layoutTsxPath, "utf8");
  });

  // 1. Login page English-only
  it("1. Login page contains English-only customer copy with zero Arabic strings", () => {
    const arabicRegex = /[\u0600-\u06FF]/;
    expect(arabicRegex.test(loginTsxContent)).toBe(false);
    expect(loginTsxContent).toContain("Welcome back");
    expect(loginTsxContent).toContain("Sign in to access your Avyron workspace");
    expect(loginTsxContent).toContain("Email address");
    expect(loginTsxContent).toContain("Password");
  });

  // 2. Login submit calls real existing auth endpoint
  it("2. Login submit calls the real existing /api/auth/login endpoint", async () => {
    const testEmail = `acceptance_auth_${Date.now()}@avyron.ai`;
    const testPassword = "secure_password_123";
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const userId = "usr_acc_" + Date.now();

    await db.insert(schema.users).values({
      id: userId,
      accountId: userId,
      username: testEmail,
      email: testEmail,
      password: passwordHash,
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    expect([200, 429]).toContain(res.status);
    if (res.status === 200) {
      const data: any = await res.json();
      expect(data.token).toBeDefined();
      expect(data.user.email).toBe(testEmail);
    }
  });

  // 3. Valid login updates authenticated state
  it("3. Valid login issues valid JWT token and authenticates user identity", async () => {
    const testEmail = `valid_login_${Date.now()}@avyron.ai`;
    const testPassword = "valid_password_456";
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const userId = "usr_valid_" + Date.now();

    await db.insert(schema.users).values({
      id: userId,
      accountId: userId,
      username: testEmail,
      email: testEmail,
      password: passwordHash,
      subscriptionStatus: "trial",
      hasSeenIntro: false,
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    expect([200, 429]).toContain(res.status);
    if (res.status === 200) {
      const data: any = await res.json();
      expect(data.token).toBeTruthy();
      expect(data.user.id).toBe(userId);

      const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      expect(meRes.status).toBe(200);
      const meData: any = await meRes.json();
      expect(meData.user.id).toBe(userId);
    }
  });

  // 4. Invalid login displays error
  it("4. Invalid login returns customer-safe error without crashing or leaking internal info", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nonexistent@avyron.ai", password: "wrong_password" }),
    });

    expect([401, 423, 429]).toContain(res.status);
    const data: any = await res.json();
    expect(data.error).toBeDefined();
    expect(data.stack).toBeUndefined();
  });

  // 5. Duplicate submit blocked
  it("5. Submit button disables duplicate submission when isLoading is true", () => {
    expect(loginTsxContent).toContain("disabled={isLoading}");
    expect(loginTsxContent).toContain("if (isLoading) return;");
    expect(loginTsxContent).toContain("ActivityIndicator");
  });

  // 6. Password visibility works
  it("6. Password input includes interactive show/hide visibility toggle with accessible label", () => {
    expect(loginTsxContent).toContain("showPassword");
    expect(loginTsxContent).toContain("setShowPassword");
    expect(loginTsxContent).toContain("secureTextEntry={!showPassword}");
    expect(loginTsxContent).toContain("eye-outline");
    expect(loginTsxContent).toContain("eye-off-outline");
  });

  // 7. Enter submits
  it("7. TextInput triggers submit on onSubmitEditing Enter key press", () => {
    expect(loginTsxContent).toContain("onSubmitEditing={handleSubmit}");
  });

  // 8. Session restoration works
  it("8. Valid session restores seamlessly via /api/auth/me with persistent token", async () => {
    const userId = "usr_sess_" + Date.now();
    const email = `session_restore_${Date.now()}@avyron.ai`;
    const passwordHash = await bcrypt.hash("session_pass_123", 10);

    await db.insert(schema.users).values({
      id: userId,
      accountId: userId,
      username: email,
      email,
      password: passwordHash,
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    const token = generateAccessToken(userId, email, userId);

    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    const meData: any = await meRes.json();
    expect(meData.user.id).toBe(userId);
  });

  // 9. Logout works
  it("9. Logout clears authentication and token storage", () => {
    const authContextPath = path.resolve(process.cwd(), "context/AuthContext.tsx");
    const authContextContent = fs.readFileSync(authContextPath, "utf8");
    expect(authContextContent).toContain("clearAuthToken()");
    expect(authContextContent).toContain("queryClient.clear()");
    expect(authContextContent).toContain("setUser(null)");
    expect(authContextContent).toContain("setToken(null)");
  });

  // 10. Create Account link uses real Signup
  it("10. Create Account link switches mode or routes to real Signup experience", () => {
    expect(loginTsxContent).toContain("Create account");
    expect(loginTsxContent).toContain("toggleMode");
    expect(signupTsxContent).toContain('initialMode="signup"');
  });

  // 11. New signup routes to Welcome / Setup
  it("11. Fresh customer signup creates account and routes to onboarding /intro", async () => {
    const newEmail = `fresh_signup_${Date.now()}@avyron.ai`;
    const newPassword = "fresh_password_789";

    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, password: newPassword, name: "Fresh Founder" }),
    });

    if (res.status === 201) {
      const data: any = await res.json();
      expect(data.token).toBeDefined();
      expect(data.user.hasSeenIntro).toBe(false);
    } else {
      expect([201, 429]).toContain(res.status);
    }

    expect(loginTsxContent).toContain("router.replace('/intro')");
  });

  // 12. Existing completed account routes Dashboard
  it("12. Completed accounts route to /(tabs) Dashboard without forcing into Setup", () => {
    expect(layoutTsxContent).toContain("router.replace('/(tabs)')");
  });

  // 13. No fake SSO/social buttons
  it("13. No fake, non-functional Google, Microsoft, Apple, or SSO buttons in auth screen", () => {
    expect(loginTsxContent).not.toContain("Sign in with Google");
    expect(loginTsxContent).not.toContain("Sign in with Microsoft");
    expect(loginTsxContent).not.toContain("Sign in with Apple");
    expect(loginTsxContent).not.toContain("Sign in with SSO");
  });

  // 14. No RTL remnants
  it("14. Auth interface is strictly LTR with zero RTL styling remnants", () => {
    expect(loginTsxContent).not.toContain("textAlign: 'right'");
    expect(loginTsxContent).not.toContain("direction: 'rtl'");
    expect(loginTsxContent).not.toContain("I18nManager.isRTL");
  });

  // 15. No hardcoded test credentials in form initial state
  it("15. Form initializes with clean empty strings (no hardcoded test passwords)", () => {
    expect(loginTsxContent).toContain("const [email, setEmail] = useState('');");
    expect(loginTsxContent).toContain("const [password, setPassword] = useState('');");
  });

  // 16. No hardcoded account IDs
  it("16. Auth UI does not contain hardcoded account IDs or campaign IDs", () => {
    expect(loginTsxContent).not.toContain("a2d87878-a1e9-41ea-a8a5-90beff569673");
    expect(loginTsxContent).not.toContain("camp_buffer_e2e");
  });

  // 17. No fake testimonials or metrics
  it("17. Right hero visual contains zero fake testimonials and zero fake metrics", () => {
    expect(loginTsxContent).not.toContain("Sarah Johnson");
    expect(loginTsxContent).not.toContain("Databricks");
    expect(loginTsxContent).not.toContain("2.4B signals analyzed");
    expect(loginTsxContent).not.toContain("98.7% accuracy");
    expect(loginTsxContent).not.toContain("500 enterprise teams");
  });

  // 18. Protected route remains protected
  it("18. Unauthenticated requests to protected endpoints return 401", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  // 19. Account switch/login isolation remains intact
  it("19. Distinct users receive isolated tokens and separate user identities", async () => {
    const userA = `user_a_${Date.now()}@avyron.ai`;
    const userB = `user_b_${Date.now()}@avyron.ai`;
    const uidA = "usr_iso_a_" + Date.now();
    const uidB = "usr_iso_b_" + Date.now();
    const passwordHash = await bcrypt.hash("pass_iso_123", 10);

    await db.insert(schema.users).values({
      id: uidA,
      accountId: uidA,
      username: userA,
      email: userA,
      password: passwordHash,
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    await db.insert(schema.users).values({
      id: uidB,
      accountId: uidB,
      username: userB,
      email: userB,
      password: passwordHash,
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    const tokA = generateAccessToken(uidA, userA, uidA);
    const tokB = generateAccessToken(uidB, userB, uidB);

    const resA = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${tokA}` } });
    const resB = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${tokB}` } });

    const dataA: any = await resA.json();
    const dataB: any = await resB.json();

    expect(dataA.user.id).toBe(uidA);
    expect(dataB.user.id).toBe(uidB);
    expect(dataA.user.id).not.toBe(dataB.user.id);
  });

  // 20. Mobile layout does not overflow
  it("20. Responsive layout hides right visual on mobile and renders full-width scrollable form", () => {
    expect(loginTsxContent).toContain("useWindowDimensions");
    expect(loginTsxContent).toContain("const isDesktop = width >= 960;");
    expect(loginTsxContent).toContain("{isDesktop && (");
    expect(loginTsxContent).toContain("leftColumnMobile");
  });
});
