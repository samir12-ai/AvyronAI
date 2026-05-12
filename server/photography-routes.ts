/**
 * Photography routes — Launch-Closure Wave 1 (P0-2) tenant isolation seal.
 *
 * Pre-seal state (master audit P0-2): photographer_profiles, portfolio_posts,
 * and reservations had no `account_id` column. authMiddleware was already
 * required on every mutation, but ANY authed user could PUT a profile they
 * didn't own, INSERT posts under a foreign photographerId, or read another
 * tenant's reservations.
 *
 * Seal:
 *   1. Migration 012 added `account_id` to all three tables.
 *   2. Inserts stamp account_id from the authed JWT.
 *   3. Updates/reads of mutation-scoped data filter by account_id, returning
 *      404 (never 403) on ownership mismatch — never leak existence.
 *   4. Profile DETAIL reads remain public-by-design (this surface is a public
 *      marketplace), but the *mutation* surface is now strictly tenant-scoped.
 *   5. Reservations LIST is now scoped to (account_id, photographer_id) —
 *      previously any authed user could list any photographer's bookings.
 */
import type { Express } from "express";
import { db } from "./db";
import { photographerProfiles, portfolioPosts, postInteractions, reservations } from "@shared/schema";
import { photographyProfileUpdateSchema } from "@shared/schema-seal3";
import { eq, desc, sql, and } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authMiddleware, optionalAuth, resolveAccountId, type AuthRequest } from "./auth";

const uploadsDir = path.resolve(process.cwd(), "uploads", "photography");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      // P0-2: server-controlled filename. Sanitised extension only.
      const rawExt = path.extname(file.originalname || "").toLowerCase();
      const safeExt = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : ".jpg";
      const uniqueName = Date.now() + "-" + Math.random().toString(36).substr(2, 9) + safeExt;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

export function registerPhotographyRoutes(app: Express) {
  app.post("/api/photography/upload-image", authMiddleware, photoUpload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const imageUrl = `/uploads/photography/${req.file.filename}`;
    res.json({ imageUrl });
  });

  // P0-2: profile creation now stamps account_id from the JWT, not the body.
  app.post("/api/photography/photographers", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const data = req.body;
      const [photographer] = await db
        .insert(photographerProfiles)
        .values({
          accountId,
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          bio: data.bio || null,
          specialties: data.specialties || null,
          profileImage: data.profileImage || null,
          coverImage: data.coverImage || null,
          location: data.location || "Dubai",
          city: data.city || "Dubai",
          country: data.country || "UAE",
          priceRange: data.priceRange || null,
          instagram: data.instagram || null,
          website: data.website || null,
        })
        .returning();
      res.json(photographer);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "A photographer with this email already exists" });
      }
      console.error("Create photographer error:", error);
      res.status(500).json({ error: "Failed to create photographer profile" });
    }
  });

  // Public read — marketplace listing. Note: pre-migration rows have NULL
  // account_id and remain visible (legacy public profiles). New rows always
  // carry account_id.
  app.get("/api/photography/photographers", optionalAuth, async (req, res) => {
    try {
      const { city, specialty } = req.query;
      let photographers = await db.select().from(photographerProfiles).orderBy(desc(photographerProfiles.rating));

      if (city) {
        photographers = photographers.filter((p) => p.city?.toLowerCase() === (city as string).toLowerCase());
      }
      if (specialty) {
        photographers = photographers.filter((p) =>
          p.specialties?.toLowerCase().includes((specialty as string).toLowerCase()),
        );
      }

      res.json(photographers);
    } catch (error) {
      console.error("List photographers error:", error);
      res.status(500).json({ error: "Failed to load photographers" });
    }
  });

  app.get("/api/photography/photographers/:id", optionalAuth, async (req, res) => {
    try {
      const [photographer] = await db
        .select()
        .from(photographerProfiles)
        .where(eq(photographerProfiles.id, req.params.id));
      if (!photographer) return res.status(404).json({ error: "Photographer not found" });
      res.json(photographer);
    } catch (error) {
      console.error("Get photographer error:", error);
      res.status(500).json({ error: "Failed to load photographer" });
    }
  });

  // P0-2 + Seal #3 F1.9: profile updates require ownership AND a strict
  // allowlist of body fields. The previous destructure-deny pattern
  // (`{ accountId, id, ...safeData }`) was fragile — any new mutable column
  // added to the table would silently become writable. The strict zod schema
  // REJECTS unknown keys with HTTP 400. Identity/audit columns (id, accountId,
  // email, rating, totalReviews, isVerified, createdAt, updatedAt) are
  // deliberately not in the allowlist so they cannot be tampered with.
  app.put("/api/photography/photographers/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const parsed = photographyProfileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        // Echo only field+code, never the offending value (avoid reflecting
        // attacker payloads back into logs/clients).
        const issues = parsed.error.issues.map(i => ({
          field: i.path.join("."),
          code: i.code,
        }));
        return res.status(400).json({ error: "INVALID_BODY", issues });
      }
      const safeData = parsed.data;
      const [updated] = await db
        .update(photographerProfiles)
        .set({ ...safeData, updatedAt: new Date() })
        .where(and(
          eq(photographerProfiles.id, req.params.id),
          eq(photographerProfiles.accountId, accountId),
        ))
        .returning();
      if (!updated) return res.status(404).json({ error: "Photographer not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update photographer error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // P0-2: post creation requires the caller to own the parent photographer row,
  // and stamps account_id from the JWT.
  app.post("/api/photography/posts", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const data = req.body;
      if (!data.photographerId) {
        return res.status(400).json({ error: "photographerId is required" });
      }
      // Ownership gate: parent photographer must belong to this account.
      const [parent] = await db
        .select({ id: photographerProfiles.id })
        .from(photographerProfiles)
        .where(and(
          eq(photographerProfiles.id, data.photographerId),
          eq(photographerProfiles.accountId, accountId),
        ))
        .limit(1);
      if (!parent) return res.status(404).json({ error: "Photographer not found" });

      const [post] = await db
        .insert(portfolioPosts)
        .values({
          accountId,
          photographerId: data.photographerId,
          imageUrl: data.imageUrl,
          title: data.title || null,
          description: data.description || null,
          category: data.category || null,
          tags: data.tags || null,
        })
        .returning();
      res.json(post);
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  app.get("/api/photography/posts", optionalAuth, async (req, res) => {
    try {
      const { photographerId } = req.query;
      if (photographerId) {
        const posts = await db
          .select()
          .from(portfolioPosts)
          .where(eq(portfolioPosts.photographerId, photographerId as string))
          .orderBy(desc(portfolioPosts.createdAt));
        return res.json(posts);
      }
      const posts = await db.select().from(portfolioPosts).orderBy(desc(portfolioPosts.createdAt));
      res.json(posts);
    } catch (error) {
      console.error("List posts error:", error);
      res.status(500).json({ error: "Failed to load posts" });
    }
  });

  app.post("/api/photography/posts/:id/interact", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { type } = req.body;
      // P0-1 (prior seal): derive userId from JWT, never trust body.
      const userId = req.userId!;
      if (!["like", "share", "reserve"].includes(type)) {
        return res.status(400).json({ error: "Invalid interaction type" });
      }

      if (type === "like") {
        const existing = await db
          .select()
          .from(postInteractions)
          .where(and(
            eq(postInteractions.postId, req.params.id),
            eq(postInteractions.userId, userId),
            eq(postInteractions.type, "like"),
          ));
        if (existing.length > 0) {
          await db.delete(postInteractions).where(eq(postInteractions.id, existing[0].id));
          await db
            .update(portfolioPosts)
            .set({ likesCount: sql`GREATEST(${portfolioPosts.likesCount} - 1, 0)` })
            .where(eq(portfolioPosts.id, req.params.id));
          return res.json({ action: "unliked" });
        }
      }

      await db.insert(postInteractions).values({
        postId: req.params.id,
        userId,
        type,
      });

      const countField = type === "like" ? portfolioPosts.likesCount
        : type === "share" ? portfolioPosts.sharesCount
        : portfolioPosts.reservesCount;

      await db
        .update(portfolioPosts)
        .set({ [type + "sCount"]: sql`${countField} + 1` })
        .where(eq(portfolioPosts.id, req.params.id));

      res.json({ action: type + "d" });
    } catch (error) {
      console.error("Interaction error:", error);
      res.status(500).json({ error: "Failed to process interaction" });
    }
  });

  // P0-2: reservations stamp account_id (the BOOKER's account). Customer
  // identity columns remain (the booker may or may not be the photographer).
  app.post("/api/photography/reservations", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const data = req.body;
      if (!data.photographerId) {
        return res.status(400).json({ error: "photographerId is required" });
      }
      const [reservation] = await db
        .insert(reservations)
        .values({
          accountId,
          photographerId: data.photographerId,
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone || null,
          eventType: data.eventType || null,
          eventDate: data.eventDate,
          eventTime: data.eventTime || null,
          location: data.location || null,
          notes: data.notes || null,
        })
        .returning();
      res.json(reservation);
    } catch (error) {
      console.error("Create reservation error:", error);
      res.status(500).json({ error: "Failed to create reservation" });
    }
  });

  // P0-2: reservation LIST is now ownership-gated. Caller must own the
  // photographer profile to see its bookings — booker emails / phones
  // are PII and were previously readable by ANY authed user.
  app.get("/api/photography/reservations/:photographerId", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      // Ownership gate.
      const [parent] = await db
        .select({ id: photographerProfiles.id })
        .from(photographerProfiles)
        .where(and(
          eq(photographerProfiles.id, req.params.photographerId),
          eq(photographerProfiles.accountId, accountId),
        ))
        .limit(1);
      if (!parent) return res.status(404).json({ error: "Photographer not found" });

      const result = await db
        .select()
        .from(reservations)
        .where(eq(reservations.photographerId, req.params.photographerId))
        .orderBy(desc(reservations.createdAt));
      res.json(result);
    } catch (error) {
      console.error("List reservations error:", error);
      res.status(500).json({ error: "Failed to load reservations" });
    }
  });

  // P0-2: status update is gated by photographer ownership (the photographer
  // updates the reservation status, not the booker).
  app.put("/api/photography/reservations/:id/status", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const { status } = req.body;
      // Look up reservation + parent photographer in one go.
      const [row] = await db
        .select({
          reservationId: reservations.id,
          photographerAccountId: photographerProfiles.accountId,
        })
        .from(reservations)
        .innerJoin(photographerProfiles, eq(photographerProfiles.id, reservations.photographerId))
        .where(eq(reservations.id, req.params.id))
        .limit(1);
      if (!row || row.photographerAccountId !== accountId) {
        return res.status(404).json({ error: "Reservation not found" });
      }

      const [updated] = await db
        .update(reservations)
        .set({ status })
        .where(eq(reservations.id, req.params.id))
        .returning();
      if (!updated) return res.status(404).json({ error: "Reservation not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update reservation error:", error);
      res.status(500).json({ error: "Failed to update reservation" });
    }
  });
}
