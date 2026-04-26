import { randomUUID } from "crypto";

export const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
