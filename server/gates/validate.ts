import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        path: e.path.join("."),
        message: e.message,
      }));
      res.status(400).json({ error: "Validation failed", details: errors });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        path: e.path.join("."),
        message: e.message,
      }));
      res.status(400).json({ error: "Query validation failed", details: errors });
      return;
    }
    next();
  };
}

export const accountIdQuery = z.object({
  accountId: z.string().min(1).default("default"),
});

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const competitorAnalyzeBody = z.object({
  username: z.string().min(1).max(100),
  accountId: z.string().min(1).default("default"),
});

export const publishPostBody = z.object({
  mediaItemId: z.string().min(1),
  caption: z.string().min(1).max(2200),
  platform: z.enum(["instagram", "facebook"]),
  accountId: z.string().min(1).default("default"),
});

export const aiContentBody = z.object({
  prompt: z.string().min(1).max(5000),
  type: z.string().optional(),
  tone: z.string().optional(),
  accountId: z.string().min(1).default("default"),
});

export const schedulePostBody = z.object({
  mediaItemId: z.string().optional(),
  caption: z.string().min(1).max(2200),
  platform: z.enum(["instagram", "facebook"]),
  scheduledDate: z.string().min(1),
  accountId: z.string().min(1).default("default"),
});
