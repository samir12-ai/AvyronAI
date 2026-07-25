/**
 * Seal #3 (Task #21) — F1.10 / F1.11 / F9.6 video upload HTTP-LEVEL proof.
 *
 * Reviewer Pass-2 demanded HTTP-level behavioral proof with a SPAWN MOCK to
 * prove that a malformed body is rejected BEFORE any ffmpeg subprocess is
 * launched. This test:
 *
 *   1. Mocks `node:child_process` so `spawn()` returns a fake child but
 *      records every invocation. spawnSpy.mock.calls.length === 0 after a
 *      rejected request proves no subprocess was launched.
 *   2. Mocks DB + auth so the route can run without infra.
 *   3. Sends a real multipart/form-data request to POST /api/video/upload-clips
 *      with a mass-assignment payload (accountId, status, outputUrl, …).
 *   4. Asserts: HTTP 400 + INVALID_BODY + db.insert NEVER called +
 *      spawn(ffmpeg|ffprobe, …) NEVER called.
 *
 * The spawn-not-called assertion is the security-critical proof: even if a
 * future regression made it past the schema, the validateFilterComplex
 * tripwire downstream would also block; this test pins the FIRST defense.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

const spawnSpy = vi.fn();
vi.mock("node:child_process", async () => {
  // Minimal fake ChildProcess that emits `close` with code 0 immediately so
  // any code path that awaits ffmpeg doesn't hang. We don't expect spawn to
  // be called in the tests below — the spy proves that.
  const { EventEmitter } = await import("node:events");
  const fake = () => {
    const ee: any = new EventEmitter();
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();
    setImmediate(() => ee.emit("close", 0));
    return ee;
  };
  return {
    spawn: (...args: any[]) => { spawnSpy(...args); return fake(); },
  };
});

vi.mock("../auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "user-test";
    req.user = { accountId: "acc-test", userId: "user-test" };
    next();
  },
  resolveAccountId: () => "acc-test",
}));

const insertSpy = vi.fn();
vi.mock("../db", () => {
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
      insert: vi.fn((...args) => { insertSpy(...args); return chain([{ id: "v1" }]); }),
      update: vi.fn(() => chain([])),
      select: vi.fn(() => chain([])),
      delete: vi.fn(() => chain([])),
    },
  };
});

// Mock the AI client so importing video-routes doesn't try to hit OpenAI.
vi.mock("../ai-client", () => ({ aiChat: vi.fn(async () => "{}") }));

let app: express.Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  const { registerVideoRoutes } = await import("../video-routes");
  app = express();
  app.use(express.json());
  registerVideoRoutes(app);
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

/** Build a minimal multipart/form-data body. Includes one tiny "video" file
 *  field (the route requires at least one upload) and the supplied form
 *  fields, which multer parses onto req.body as strings. */
function buildMultipart(fields: Record<string, string>, fileFieldName = "clips") {
  const boundary = "----TestBoundary" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
      ),
    );
  }
  // Tiny stub MP4-ish file so multer accepts it (just needs a video/* mimetype).
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
    ),
  );
  parts.push(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])); // ftyp box prefix
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function request(opts: { method: string; path: string; body: Buffer; contentType: string }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          "content-type": opts.contentType,
          "content-length": String(opts.body.length),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          try { resolve({ status: res.statusCode!, body: buf ? JSON.parse(buf) : null }); }
          catch { resolve({ status: res.statusCode!, body: buf }); }
        });
      },
    );
    req.on("error", reject);
    req.write(opts.body);
    req.end();
  });
}

describe("Seal #3 F1.10 — video upload-clips HTTP proof", () => {
  it("mass-assignment body → 400 INVALID_BODY, db.insert + spawn NEVER called", async () => {
    insertSpy.mockClear();
    spawnSpy.mockClear();
    const { body, contentType } = buildMultipart({
      title: "Legit Title",
      accountId: "attacker-acc",         // identity hijack — must be rejected
      status: "completed",                // server-managed — must be rejected
      outputUrl: "/uploads/evil.mp4",     // server-managed — must be rejected
      clipCount: "999",                   // server-managed — must be rejected
    });
    const r = await request({ method: "POST", path: "/api/video/upload-clips", body, contentType });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_BODY");
    const codes = (r.body.issues ?? []).map((i: any) => i.code);
    expect(codes).toContain("unrecognized_keys");
    // SECURITY-CRITICAL: no DB write, no subprocess spawn.
    expect(insertSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("shell-meta in title → 400 INVALID_BODY, db.insert + spawn NEVER called", async () => {
    insertSpy.mockClear();
    spawnSpy.mockClear();
    const { body, contentType } = buildMultipart({ title: "title; rm -rf /" });
    const r = await request({ method: "POST", path: "/api/video/upload-clips", body, contentType });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_BODY");
    expect(insertSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
