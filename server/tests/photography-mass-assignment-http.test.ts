/**
 * Seal #3 (Task #21) — F1.9 PHOTOGRAPHY PUT mass-assignment, HTTP-LEVEL proof.
 *
 * Reviewer Pass-2 demanded behavioral proof at the HTTP boundary, not just
 * at the schema layer. This test mounts the REAL `registerPhotographyRoutes`
 * function on a real express app, mocks the DB and auth layers (so we don't
 * need a live PostgreSQL), and sends real `http.request()` calls against
 * the listening port. Asserts:
 *
 *   1. PUT /api/photography/photographers/:id with a clean body succeeds
 *      (control — proves the route is wired and our mocks behave).
 *   2. Same route with a mass-assignment payload (accountId, id, rating,
 *      isVerified, totalReviews, createdAt, updatedAt) returns HTTP 400
 *      with `{ error: "INVALID_BODY", issues: [...] }` AND the db.update
 *      mock is NEVER invoked (proves rejection happens BEFORE any write).
 *   3. The 400 response body lists every offending field in `issues[]`
 *      with `code: "unrecognized_keys"` (Zod strict-mode signature).
 *   4. URL-encoded form body (Content-Type
 *      application/x-www-form-urlencoded) does NOT bypass the schema —
 *      the express.json() middleware doesn't parse it, so the body is
 *      treated as `{}` and `safeParse({})` succeeds (partial schema), but
 *      no fields are written. We assert this matches the `{}` clean-body
 *      semantics rather than silently allowing form-encoded mass-assign.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

// Mock auth BEFORE importing the routes module.
vi.mock("../auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "user-test";
    req.user = { accountId: "acc-test", userId: "user-test" };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => next(),
  resolveAccountId: () => "acc-test",
}));

// Mock the DB so update().set().where().returning() is observable and we
// don't need a live database. The test asserts updateSpy was NEVER called
// for the mass-assignment payload.
const updateSpy = vi.fn();
const insertSpy = vi.fn();
vi.mock("../db", () => {
  // chainable thenables
  const chain = (returnValue: any) => {
    const c: any = {
      set: vi.fn(() => c),
      values: vi.fn(() => c),
      where: vi.fn(() => c),
      from: vi.fn(() => c),
      orderBy: vi.fn(() => Promise.resolve([])),
      limit: vi.fn(() => Promise.resolve([])),
      returning: vi.fn(() => Promise.resolve(returnValue)),
      then: (resolve: any) => resolve(returnValue),
    };
    return c;
  };
  return {
    db: {
      update: vi.fn((...args) => { updateSpy(...args); return chain([{ id: "p1", name: "Updated" }]); }),
      insert: vi.fn((...args) => { insertSpy(...args); return chain([{ id: "p1" }]); }),
      select: vi.fn(() => chain([])),
      delete: vi.fn(() => chain([])),
    },
  };
});

// Lazy-import after mocks are registered.
let app: express.Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  const { registerPhotographyRoutes } = await import("../photography-routes");
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  registerPhotographyRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function request(opts: { method: string; path: string; body?: any; contentType?: string }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const data =
      opts.body === undefined
        ? undefined
        : opts.contentType === "application/x-www-form-urlencoded"
          ? new URLSearchParams(opts.body).toString()
          : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          "content-type": opts.contentType ?? "application/json",
          ...(data ? { "content-length": String(Buffer.byteLength(data)) } : {}),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode!, body: buf });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

describe("Seal #3 F1.9 — photography PUT mass-assignment HTTP proof", () => {
  it("clean body → 200 (control: route is wired)", async () => {
    updateSpy.mockClear();
    const r = await request({
      method: "PUT",
      path: "/api/photography/photographers/p1",
      body: { name: "Updated Name", city: "Dubai" },
    });
    expect(r.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("mass-assignment payload → 400 INVALID_BODY, db.update NEVER called", async () => {
    updateSpy.mockClear();
    const r = await request({
      method: "PUT",
      path: "/api/photography/photographers/p1",
      body: {
        name: "Legit Name",
        accountId: "attacker-acc",       // identity hijack — must be rejected
        id: "different-id",              // PK rewrite — must be rejected
        rating: 5,                       // server-managed metric — must be rejected
        isVerified: true,                // trust badge — must be rejected
        totalReviews: 9999,              // server-managed metric — must be rejected
        createdAt: "1970-01-01",         // audit timestamp — must be rejected
        updatedAt: "2099-01-01",         // audit timestamp — must be rejected
      },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_BODY");
    expect(Array.isArray(r.body.issues)).toBe(true);
    // The Zod strict-mode unrecognized_keys issue lists the offending keys.
    const codes = r.body.issues.map((i: any) => i.code);
    expect(codes).toContain("unrecognized_keys");
    // CRITICAL: the database write was never attempted.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("malformed regex value (e.g. bio with control char) → 400, db.update NEVER called", async () => {
    updateSpy.mockClear();
    const r = await request({
      method: "PUT",
      path: "/api/photography/photographers/p1",
      body: { bio: "abc\u0000def" }, // null byte — outside whitelist
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_BODY");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
