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

describe("Avyron Post-Signup Welcome Screen Redesign Acceptance Suite", () => {
  const introTsxPath = path.resolve(process.cwd(), "app/intro.tsx");
  const loginTsxPath = path.resolve(process.cwd(), "app/login.tsx");
  const layoutTsxPath = path.resolve(process.cwd(), "app/_layout.tsx");

  let introTsxContent = "";
  let loginTsxContent = "";
  let layoutTsxContent = "";

  beforeAll(() => {
    introTsxContent = fs.readFileSync(introTsxPath, "utf8");
    loginTsxContent = fs.readFileSync(loginTsxPath, "utf8");
    layoutTsxContent = fs.readFileSync(layoutTsxPath, "utf8");
  });

  // 1. English-only copy with zero Arabic
  it("1. Welcome page is English-only with zero Arabic characters", () => {
    const arabicRegex = /[\u0600-\u06FF]/;
    expect(arabicRegex.test(introTsxContent)).toBe(false);
  });

  // 2. Old Arabic splash UI completely removed
  it("2. Old Arabic splash screen implementation is completely removed", () => {
    expect(introTsxContent).not.toContain("t('intro.headline')");
    expect(introTsxContent).not.toContain("t('intro.subline')");
    expect(introTsxContent).not.toContain("trialBadge");
  });

  // 3. Follows Sign In design system tokens
  it("3. Follows Sign In design system tokens (near-black background, 2-column layout, purple accents)", () => {
    expect(introTsxContent).toContain("#07040E");
    expect(introTsxContent).toContain("isDesktop");
    expect(introTsxContent).toContain("auth-hero.jpg");
    expect(introTsxContent).toContain("AvyronLogo");
  });

  // 4. Status eyebrow ACCOUNT CREATED
  it("4. Status eyebrow displays ACCOUNT CREATED", () => {
    expect(introTsxContent).toContain("ACCOUNT CREATED");
  });

  // 5. Canonical Welcome headline and subhead
  it("5. Primary copy matches required onboarding text", () => {
    expect(introTsxContent).toContain("Welcome to Avyron");
    expect(introTsxContent).toContain("Let's build your market intelligence workspace.");
    expect(introTsxContent).toContain("We'll learn how your business works, understand your market");
  });

  // 6. Onboarding 5-step preview list
  it("6. Displays the 5 lightweight onboarding preview steps", () => {
    expect(introTsxContent).toContain("Understand your business");
    expect(introTsxContent).toContain("Choose your market and focus");
    expect(introTsxContent).toContain("Connect your channels");
    expect(introTsxContent).toContain("Discover your competitors");
    expect(introTsxContent).toContain("Build your strategy");
  });

  // 7. Primary CTA Set up my workspace
  it("7. Primary CTA button is 'Set up my workspace' with routing to /setup", () => {
    expect(introTsxContent).toContain("Set up my workspace");
    expect(introTsxContent).toContain("router.replace('/setup')");
  });

  // 8. Secondary copy
  it("8. Secondary reassurance copy 'Takes only a few minutes.'", () => {
    expect(introTsxContent).toContain("Takes only a few minutes.");
  });

  // 9. No fake product claims or testimonials
  it("9. Contains zero fake testimonials, fake user counts, or fake metrics", () => {
    expect(introTsxContent).not.toContain("10,000 companies");
    expect(introTsxContent).not.toContain("40% increase");
    expect(introTsxContent).not.toContain("Trusted by");
  });

  // 10. Signup routes to /intro
  it("10. Signup submission routes new authenticated user to /intro", () => {
    expect(loginTsxContent).toContain("router.replace('/intro')");
  });

  // 11. Backend /api/auth/seen-intro updates hasSeenIntro in database
  it("11. Backend /api/auth/seen-intro updates hasSeenIntro: true in database", async () => {
    const testEmail = `welcome_user_${Date.now()}@avyron.ai`;
    const testPassword = "welcome_password_123";
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const userId = "usr_wel_" + Date.now();

    await db.insert(schema.users).values({
      id: userId,
      accountId: userId,
      username: testEmail,
      email: testEmail,
      password: passwordHash,
      subscriptionStatus: "trial",
      hasSeenIntro: false,
    });

    let token: string;
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    if (loginRes.status === 200) {
      const loginData: any = await loginRes.json();
      token = loginData.token;
    } else {
      token = generateAccessToken(userId, testEmail, userId);
    }

    // Call seen-intro
    const seenRes = await fetch(`${BASE_URL}/api/auth/seen-intro`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(seenRes.status).toBe(200);

    const [updatedUser] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(updatedUser.hasSeenIntro).toBe(true);
  });

  // 12. AuthGate rules: new user (!hasSeenIntro) routes to /intro, completed user to /(tabs)
  it("12. AuthGate redirects new user to /intro and completed user to /(tabs)", () => {
    expect(layoutTsxContent).toContain("!user?.hasSeenIntro && !inSetup");
    expect(layoutTsxContent).toContain("router.replace('/intro')");
    expect(layoutTsxContent).toContain("router.replace('/(tabs)')");
  });
});
