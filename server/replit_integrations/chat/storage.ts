import { db } from "../../db";
import { conversations, messages } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IChatStorage {
  getConversation(id: number, accountId: string): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(accountId: string): Promise<(typeof conversations.$inferSelect)[]>;
  createConversation(title: string, accountId: string): Promise<typeof conversations.$inferSelect>;
  deleteConversation(id: number, accountId: string): Promise<void>;
  getMessagesByConversation(conversationId: number, accountId: string): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<typeof messages.$inferSelect>;
}

export const chatStorage: IChatStorage = {
  async getConversation(id: number, accountId: string) {
    const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.accountId, accountId)));
    return conversation;
  },

  async getAllConversations(accountId: string) {
    return db.select().from(conversations).where(eq(conversations.accountId, accountId)).orderBy(desc(conversations.createdAt));
  },

  async createConversation(title: string, accountId: string) {
    const [conversation] = await db.insert(conversations).values({ title, accountId }).returning();
    return conversation;
  },

  async deleteConversation(id: number, accountId: string) {
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.accountId, accountId)));
    if (!conv) return;
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.accountId, accountId)));
  },

  async getMessagesByConversation(conversationId: number, accountId: string) {
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.accountId, accountId)));
    if (!conv) return [];
    return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const [message] = await db.insert(messages).values({ conversationId, role, content }).returning();
    return message;
  },
};
