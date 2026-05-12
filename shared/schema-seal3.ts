import { z } from "zod";

const PHOTO_TEXT = /^[A-Za-z0-9 .,'"!?@()_+\-\/\[\]]{0,500}$/;
const PHOTO_URL = /^https?:\/\/[A-Za-z0-9._~:\/?#\[\]@!$'()*+,;=%\-]{1,500}$/i;
const PHOTO_HANDLE = /^[A-Za-z0-9._@:\-\/]{1,100}$/;
const PHOTO_PHONE = /^[+0-9 ()\-]{0,40}$/;
const PHOTO_PATH = /^[A-Za-z0-9._\-\/]{0,500}$/;

export const photographyProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).regex(PHOTO_TEXT).optional(),
    phone: z.string().trim().max(40).regex(PHOTO_PHONE).nullable().optional(),
    bio: z.string().trim().max(2000).regex(PHOTO_TEXT).nullable().optional(),
    specialties: z.string().trim().max(500).regex(PHOTO_TEXT).nullable().optional(),
    profileImage: z.string().trim().max(500).regex(PHOTO_PATH).nullable().optional(),
    coverImage: z.string().trim().max(500).regex(PHOTO_PATH).nullable().optional(),
    location: z.string().trim().max(120).regex(PHOTO_TEXT).optional(),
    city: z.string().trim().max(120).regex(PHOTO_TEXT).optional(),
    country: z.string().trim().max(120).regex(PHOTO_TEXT).optional(),
    priceRange: z.string().trim().max(120).regex(PHOTO_TEXT).nullable().optional(),
    instagram: z.string().trim().max(120).regex(PHOTO_HANDLE).nullable().optional(),
    website: z.string().trim().max(500).regex(PHOTO_URL).nullable().optional(),
  })
  .strict();

export type PhotographyProfileUpdate = z.infer<typeof photographyProfileUpdateSchema>;

const VIDEO_TITLE = /^[A-Za-z0-9 .,'"!?@()_+\-\/\[\]]{1,200}$/;
const VIDEO_TAG = /^[A-Za-z0-9 _\-]{1,50}$/;

export const videoProjectCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).regex(VIDEO_TITLE).optional(),
    style: z.string().trim().min(1).max(50).regex(VIDEO_TAG).optional(),
    mood: z.string().trim().min(1).max(50).regex(VIDEO_TAG).optional(),
  })
  .strict();

export type VideoProjectCreate = z.infer<typeof videoProjectCreateSchema>;
