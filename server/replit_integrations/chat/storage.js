import { db } from "../../db";
import { conversations, messages } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
export const chatStorage = {
    async getConversation(id, accountId) {
        const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.accountId, accountId)));
        return conversation;
    },
    async getAllConversations(accountId) {
        return db.select().from(conversations).where(eq(conversations.accountId, accountId)).orderBy(desc(conversations.createdAt));
    },
    async createConversation(title, accountId) {
        const [conversation] = await db.insert(conversations).values({ title, accountId }).returning();
        return conversation;
    },
    async deleteConversation(id, accountId) {
        const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.accountId, accountId)));
        if (!conv)
            return;
        await db.delete(messages).where(eq(messages.conversationId, id));
        await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.accountId, accountId)));
    },
    async getMessagesByConversation(conversationId, accountId) {
        const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.accountId, accountId)));
        if (!conv)
            return [];
        return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
    },
    async createMessage(conversationId, role, content) {
        const [message] = await db.insert(messages).values({ conversationId, role, content }).returning();
        return message;
    },
};
