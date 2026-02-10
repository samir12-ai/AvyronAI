import type { Express } from "express";
import { db } from "./db";
import { photographerProfiles, portfolioPosts, postInteractions, reservations } from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";

const uploadsDir = path.join(process.cwd(), "uploads", "photography");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const uniqueName = Date.now() + '-' + Math.random().toString(36).substr(2, 9) + path.extname(file.originalname);
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

export function registerPhotographyRoutes(app: Express) {
  app.post("/api/photography/upload-image", photoUpload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const imageUrl = `/uploads/photography/${req.file.filename}`;
    res.json({ imageUrl });
  });

  app.post("/api/photography/photographers", async (req, res) => {
    try {
      const data = req.body;
      const [photographer] = await db.insert(photographerProfiles).values({
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
      }).returning();
      res.json(photographer);
    } catch (error: any) {
      if (error?.code === '23505') {
        return res.status(409).json({ error: "A photographer with this email already exists" });
      }
      console.error("Create photographer error:", error);
      res.status(500).json({ error: "Failed to create photographer profile" });
    }
  });

  app.get("/api/photography/photographers", async (req, res) => {
    try {
      const { city, specialty } = req.query;
      let photographers = await db.select().from(photographerProfiles).orderBy(desc(photographerProfiles.rating));

      if (city) {
        photographers = photographers.filter(p => p.city?.toLowerCase() === (city as string).toLowerCase());
      }
      if (specialty) {
        photographers = photographers.filter(p =>
          p.specialties?.toLowerCase().includes((specialty as string).toLowerCase())
        );
      }

      res.json(photographers);
    } catch (error) {
      console.error("List photographers error:", error);
      res.status(500).json({ error: "Failed to load photographers" });
    }
  });

  app.get("/api/photography/photographers/:id", async (req, res) => {
    try {
      const [photographer] = await db.select().from(photographerProfiles).where(eq(photographerProfiles.id, req.params.id));
      if (!photographer) return res.status(404).json({ error: "Photographer not found" });
      res.json(photographer);
    } catch (error) {
      console.error("Get photographer error:", error);
      res.status(500).json({ error: "Failed to load photographer" });
    }
  });

  app.put("/api/photography/photographers/:id", async (req, res) => {
    try {
      const data = req.body;
      const [updated] = await db.update(photographerProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(photographerProfiles.id, req.params.id))
        .returning();
      if (!updated) return res.status(404).json({ error: "Photographer not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update photographer error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/photography/posts", async (req, res) => {
    try {
      const data = req.body;
      const [post] = await db.insert(portfolioPosts).values({
        photographerId: data.photographerId,
        imageUrl: data.imageUrl,
        title: data.title || null,
        description: data.description || null,
        category: data.category || null,
        tags: data.tags || null,
      }).returning();
      res.json(post);
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  app.get("/api/photography/posts", async (req, res) => {
    try {
      const { photographerId } = req.query;
      let query = db.select().from(portfolioPosts).orderBy(desc(portfolioPosts.createdAt));

      if (photographerId) {
        const posts = await db.select().from(portfolioPosts)
          .where(eq(portfolioPosts.photographerId, photographerId as string))
          .orderBy(desc(portfolioPosts.createdAt));
        return res.json(posts);
      }

      const posts = await query;
      res.json(posts);
    } catch (error) {
      console.error("List posts error:", error);
      res.status(500).json({ error: "Failed to load posts" });
    }
  });

  app.post("/api/photography/posts/:id/interact", async (req, res) => {
    try {
      const { type, userId } = req.body;
      if (!['like', 'share', 'reserve'].includes(type)) {
        return res.status(400).json({ error: "Invalid interaction type" });
      }

      if (type === 'like') {
        const existing = await db.select().from(postInteractions)
          .where(and(
            eq(postInteractions.postId, req.params.id),
            eq(postInteractions.userId, userId),
            eq(postInteractions.type, 'like')
          ));
        if (existing.length > 0) {
          await db.delete(postInteractions).where(eq(postInteractions.id, existing[0].id));
          await db.update(portfolioPosts)
            .set({ likesCount: sql`GREATEST(${portfolioPosts.likesCount} - 1, 0)` })
            .where(eq(portfolioPosts.id, req.params.id));
          return res.json({ action: 'unliked' });
        }
      }

      await db.insert(postInteractions).values({
        postId: req.params.id,
        userId,
        type,
      });

      const countField = type === 'like' ? portfolioPosts.likesCount
        : type === 'share' ? portfolioPosts.sharesCount
        : portfolioPosts.reservesCount;

      await db.update(portfolioPosts)
        .set({ [type + 'sCount']: sql`${countField} + 1` })
        .where(eq(portfolioPosts.id, req.params.id));

      res.json({ action: type + 'd' });
    } catch (error) {
      console.error("Interaction error:", error);
      res.status(500).json({ error: "Failed to process interaction" });
    }
  });

  app.post("/api/photography/reservations", async (req, res) => {
    try {
      const data = req.body;
      const [reservation] = await db.insert(reservations).values({
        photographerId: data.photographerId,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone || null,
        eventType: data.eventType || null,
        eventDate: data.eventDate,
        eventTime: data.eventTime || null,
        location: data.location || null,
        notes: data.notes || null,
      }).returning();
      res.json(reservation);
    } catch (error) {
      console.error("Create reservation error:", error);
      res.status(500).json({ error: "Failed to create reservation" });
    }
  });

  app.get("/api/photography/reservations/:photographerId", async (req, res) => {
    try {
      const result = await db.select().from(reservations)
        .where(eq(reservations.photographerId, req.params.photographerId))
        .orderBy(desc(reservations.createdAt));
      res.json(result);
    } catch (error) {
      console.error("List reservations error:", error);
      res.status(500).json({ error: "Failed to load reservations" });
    }
  });

  app.put("/api/photography/reservations/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const [updated] = await db.update(reservations)
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
