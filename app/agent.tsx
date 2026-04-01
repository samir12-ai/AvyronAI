import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  useColorScheme,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getApiUrl , authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import { fetch } from 'expo/fetch';

const P = {
  mint: '#8B5CF6',
  neon: '#39FF14',
  bg: { dark: '#080C10', light: '#F4F7F5' },
  card: { dark: '#0F1419', light: '#FFFFFF' },
  border: { dark: '#1A2030', light: '#E2E8E4' },
  text: { dark: '#E8EDF2', light: '#1A2332' },
  muted: { dark: '#8892A4', light: '#546478' },
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: number;
  title: string;
}

export default function AgentScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const baseUrl = getApiUrl();
  const { selectedCampaignId } = useCampaign();
  const isWeb = Platform.OS === 'web';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const textPrimary = isDark ? P.text.dark : P.text.light;
  const textMuted = isDark ? P.muted.dark : P.muted.light;
  const bgColor = isDark ? P.bg.dark : P.bg.light;
  const cardBg = isDark ? P.card.dark : P.card.light;
  const borderColor = isDark ? P.border.dark : P.border.light;

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await globalThis.fetch(new URL('/api/conversations', baseUrl).toString());
      const data = await res.json();
      setConversations(data || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [baseUrl]);

  const createConversation = useCallback(async () => {
    try {
      const res = await globalThis.fetch(new URL('/api/conversations', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat' }),
      });
      const conv = await res.json();
      setConversations(prev => [conv, ...prev]);
      setActiveConvId(conv.id);
      setMessages([]);
      setShowSidebar(false);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }, [baseUrl]);

  const loadConversation = useCallback(async (id: number) => {
    try {
      const res = await globalThis.fetch(new URL(`/api/conversations/${id}`, baseUrl).toString());
      const data = await res.json();
      setActiveConvId(id);
      setMessages(
        (data.messages || []).map((m: any) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
        }))
      );
      setShowSidebar(false);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }, [baseUrl]);

  const deleteConversation = useCallback(async (id: number) => {
    try {
      await globalThis.fetch(new URL(`/api/conversations/${id}`, baseUrl).toString(), {
        method: 'DELETE',
      });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }, [baseUrl, activeConvId]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending) return;

    let convId = activeConvId;

    if (!convId) {
      try {
        const res = await globalThis.fetch(new URL('/api/conversations', baseUrl).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: input.trim().slice(0, 40) }),
        });
        const conv = await res.json();
        convId = conv.id;
        setActiveConvId(conv.id);
        setConversations(prev => [conv, ...prev]);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };

    const currentInput = input.trim();
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setStreamingContent('');

    try {
      const res = await authFetch(
        new URL(`/api/conversations/${convId}/messages`, baseUrl).toString(),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: currentInput,
            campaignId: selectedCampaignId,
          }),
        }
      );

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let fullContent = '';
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const parts = sseBuffer.split('\n\n');
        sseBuffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  fullContent += data.content;
                  setStreamingContent(fullContent);
                }
                if (data.done) {
                  const assistantMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: fullContent,
                  };
                  setMessages(prev => [...prev, assistantMsg]);
                  setStreamingContent('');
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages(prev => [...prev, errorMsg]);
      setStreamingContent('');
    } finally {
      setSending(false);
    }
  }, [input, sending, activeConvId, baseUrl, selectedCampaignId]);

  const allMessages = streamingContent
    ? [...messages, { id: 'streaming', role: 'assistant' as const, content: streamingContent }]
    : messages;

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[
        s.messageRow,
        { justifyContent: isUser ? 'flex-end' : 'flex-start' }
      ]}>
        {!isUser && (
          <View style={[s.avatar, { backgroundColor: P.mint + '20' }]}>
            <Ionicons name="sparkles" size={14} color={P.mint} />
          </View>
        )}
        <View style={[
          s.bubble,
          isUser
            ? { backgroundColor: P.mint, maxWidth: '75%' }
            : { backgroundColor: cardBg, borderWidth: 1, borderColor, maxWidth: '85%' }
        ]}>
          <Text style={[
            s.messageText,
            { color: isUser ? '#fff' : textPrimary }
          ]}>
            {item.content}
            {item.id === 'streaming' && '▍'}
          </Text>
        </View>
      </View>
    );
  }, [isDark, textPrimary, cardBg, borderColor]);

  const renderEmpty = useCallback(() => (
    <View style={s.emptyContainer}>
      <View style={[s.emptyIcon, { backgroundColor: P.mint + '15' }]}>
        <Ionicons name="sparkles" size={32} color={P.mint} />
      </View>
      <Text style={[s.emptyTitle, { color: textPrimary }]}>Avyron Agent</Text>
      <Text style={[s.emptySubtitle, { color: textMuted }]}>
        Your strategic operations manager. Ask about your plan, execution status, what to create next, or get marketing guidance.
      </Text>
      <View style={s.suggestionsGrid}>
        {[
          "What should I create today?",
          "Explain my current plan",
          "What's my execution progress?",
          "Suggest content ideas",
        ].map((suggestion, i) => (
          <Pressable
            key={i}
            style={[s.suggestion, { backgroundColor: cardBg, borderColor }]}
            onPress={() => {
              setInput(suggestion);
            }}
          >
            <Text style={[s.suggestionText, { color: textPrimary }]}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ), [textPrimary, textMuted, cardBg, borderColor]);

  return (
    <View style={[s.container, { backgroundColor: bgColor }]}>
      <View style={[s.header, {
        paddingTop: isWeb ? 67 : insets.top,
        backgroundColor: cardBg,
        borderBottomColor: borderColor,
      }]}>
        <Pressable onPress={() => router.back()} style={s.headerBtn} testID="agent-back">
          <Ionicons name="chevron-back" size={24} color={textPrimary} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={[s.headerTitle, { color: textPrimary }]}>Agent</Text>
          {selectedCampaignId && (
            <View style={[s.connectedBadge, { backgroundColor: P.neon + '20' }]}>
              <View style={[s.connectedDot, { backgroundColor: P.neon }]} />
              <Text style={[s.connectedText, { color: P.neon }]}>System Connected</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setShowSidebar(!showSidebar)} style={s.headerBtn} testID="agent-history">
            <Ionicons name="time-outline" size={22} color={textPrimary} />
          </Pressable>
          <Pressable onPress={createConversation} style={s.headerBtn} testID="agent-new-chat">
            <Ionicons name="add" size={24} color={P.mint} />
          </Pressable>
        </View>
      </View>

      {showSidebar && (
        <View style={[s.sidebar, { backgroundColor: cardBg, borderRightColor: borderColor }]}>
          <View style={s.sidebarHeader}>
            <Text style={[s.sidebarTitle, { color: textPrimary }]}>History</Text>
            <Pressable onPress={() => setShowSidebar(false)}>
              <Ionicons name="close" size={20} color={textMuted} />
            </Pressable>
          </View>
          <FlatList
            data={conversations}
            keyExtractor={item => String(item.id)}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  s.convItem,
                  activeConvId === item.id && { backgroundColor: P.mint + '15' },
                ]}
                onPress={() => loadConversation(item.id)}
              >
                <Ionicons name="chatbubble-outline" size={16} color={textMuted} />
                <Text style={[s.convTitle, { color: textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    deleteConversation(item.id);
                  }}
                  style={s.convDelete}
                >
                  <Ionicons name="trash-outline" size={14} color={textMuted} />
                </Pressable>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={[s.emptyConvs, { color: textMuted }]}>No conversations yet</Text>
            }
          />
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={allMessages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            s.messagesList,
            allMessages.length === 0 && { flex: 1, justifyContent: 'center' },
          ]}
          onContentSizeChange={() => {
            if (allMessages.length > 0) {
              flatListRef.current?.scrollToEnd({ animated: true });
            }
          }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          testID="agent-messages"
        />

        <View style={[s.inputBar, {
          backgroundColor: cardBg,
          borderTopColor: borderColor,
          paddingBottom: isWeb ? 34 : Math.max(insets.bottom, 8),
        }]}>
          <TextInput
            style={[s.textInput, {
              backgroundColor: isDark ? '#151B24' : '#F0F3F1',
              color: textPrimary,
            }]}
            placeholder="Ask your marketing agent..."
            placeholderTextColor={textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            multiline
            maxLength={2000}
            testID="agent-input"
          />
          <Pressable
            style={[s.sendBtn, {
              backgroundColor: input.trim() && !sending ? P.mint : (isDark ? '#1A2030' : '#E2E8E4'),
            }]}
            onPress={sendMessage}
            disabled={!input.trim() || sending}
            testID="agent-send"
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={20} color={input.trim() ? '#fff' : textMuted} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 4,
  },
  headerBtn: { padding: 6 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' as const },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 2,
  },
  connectedDot: { width: 5, height: 5, borderRadius: 3 },
  connectedText: { fontSize: 9, fontWeight: '600' as const },
  sidebar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 280,
    zIndex: 100,
    borderLeftWidth: 1,
    paddingTop: 100,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 12,
  },
  sidebarTitle: { fontSize: 16, fontWeight: '700' as const },
  convItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  convTitle: { flex: 1, fontSize: 13 },
  convDelete: { padding: 4 },
  emptyConvs: { padding: 20, textAlign: 'center', fontSize: 13 },
  messagesList: { padding: 16 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  messageText: { fontSize: 14, lineHeight: 20 },
  emptyContainer: { alignItems: 'center', paddingHorizontal: 32 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '700' as const, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  suggestionsGrid: { gap: 8, width: '100%' },
  suggestion: { borderWidth: 1, borderRadius: 12, padding: 12 },
  suggestionText: { fontSize: 13 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
