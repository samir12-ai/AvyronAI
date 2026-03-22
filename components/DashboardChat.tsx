import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getApiUrl , authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import { fetch } from 'expo/fetch';

const P = {
  mint: '#8B5CF6',
  neon: '#39FF14',
  darkBg: '#080C10',
  darkCard: '#0F1419',
  darkCardBorder: '#1A2030',
  darkSurface: '#151B24',
  lightCard: '#FFFFFF',
  lightCardBorder: '#E2E8E4',
  lightSurface: '#F0F3F1',
  textDark: '#E8EDF2',
  textLight: '#1A2332',
  mutedDark: '#8892A4',
  mutedLight: '#546478',
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function DashboardChat() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const baseUrl = getApiUrl();
  const { selectedCampaignId } = useCampaign();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
    setStreamingContent('');
    setExpanded(false);
  }, [selectedCampaignId]);

  const textPrimary = isDark ? P.textDark : P.textLight;
  const textMuted = isDark ? P.mutedDark : P.mutedLight;
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const cardBorder = isDark ? P.darkCardBorder : P.lightCardBorder;
  const surfaceBg = isDark ? P.darkSurface : P.lightSurface;

  const sendMessage = useCallback(async (overrideInput?: string) => {
    const text = (overrideInput || input).trim();
    if (!text || sending) return;

    Keyboard.dismiss();
    let convId = activeConvId;

    if (!convId) {
      try {
        const res = await globalThis.fetch(new URL('/api/conversations', baseUrl).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 40) }),
        });
        const conv = await res.json();
        convId = conv.id;
        setActiveConvId(conv.id);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    };

    const currentInput = text;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setStreamingContent('');
    setExpanded(true);

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

      if (!res.ok) {
        let errText = 'Server error';
        try { const j = await res.json(); errText = j.error || j.message || errText; } catch {}
        throw new Error(errText);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let fullContent = '';
      let sseBuffer = '';
      let receivedDone = false;

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
                  receivedDone = true;
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

      if (!receivedDone && fullContent) {
        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: fullContent,
        };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamingContent('');
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

  const handleNewChat = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
    setStreamingContent('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSuggestion = useCallback((text: string) => {
    setInput(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => sendMessage(text), 50);
  }, [sendMessage]);

  const suggestions = [
    "What should I create today?",
    "Explain my current plan",
    "What's my execution progress?",
    "Suggest content ideas",
  ];

  const hasMessages = allMessages.length > 0;
  return (
    <View style={[st.container, { backgroundColor: cardBg, borderColor: cardBorder }]} testID="dashboard-chat">
      <View style={st.header}>
        <View style={st.headerLeft}>
          <View style={[st.agentDot, { backgroundColor: P.mint }]} />
          <Text style={[st.headerTitle, { color: textPrimary }]}>MarketMind Agent</Text>
          {selectedCampaignId && (
            <View style={[st.connectedBadge, { backgroundColor: P.neon + '20' }]}>
              <View style={[st.connectedDotSmall, { backgroundColor: P.neon }]} />
            </View>
          )}
        </View>
        <View style={st.headerRight}>
          {hasMessages && (
            <Pressable onPress={handleNewChat} style={st.headerBtn} testID="dashboard-chat-new">
              <Ionicons name="add-circle-outline" size={20} color={textMuted} />
            </Pressable>
          )}
          {hasMessages && (
            <Pressable
              onPress={() => { setExpanded(!expanded); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={st.headerBtn}
            >
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {!hasMessages ? (
        <View style={st.suggestionsWrap}>
          <Text style={[st.suggestionsLabel, { color: textMuted }]}>
            Ask about your strategy, plan, execution, or get marketing guidance
          </Text>
          <View style={st.suggestionsGrid}>
            {suggestions.map((s, i) => (
              <Pressable
                key={i}
                style={[st.suggestion, { backgroundColor: surfaceBg, borderColor: cardBorder }]}
                onPress={() => handleSuggestion(s)}
              >
                <Text style={[st.suggestionText, { color: textPrimary }]} numberOfLines={1}>{s}</Text>
                <Ionicons name="arrow-forward" size={14} color={textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : expanded ? (
        <View style={{ height: 320 }}>
          <FlatList
            ref={flatListRef}
            data={allMessages}
            keyExtractor={item => item.id}
            renderItem={({ item }) => {
              const isUser = item.role === 'user';
              return (
                <View style={[st.msgRow, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}>
                  {!isUser && (
                    <View style={[st.avatar, { backgroundColor: P.mint + '20' }]}>
                      <Ionicons name="sparkles" size={12} color={P.mint} />
                    </View>
                  )}
                  <View style={[
                    st.bubble,
                    isUser
                      ? { backgroundColor: P.mint, maxWidth: '75%' }
                      : { backgroundColor: surfaceBg, borderWidth: 1, borderColor: cardBorder, maxWidth: '85%' }
                  ]}>
                    <Text style={[st.msgText, { color: isUser ? '#fff' : textPrimary }]}>
                      {item.content}
                      {item.id === 'streaming' && '▍'}
                    </Text>
                  </View>
                </View>
              );
            }}
            contentContainerStyle={st.messagesList}
            onContentSizeChange={() => {
              if (allMessages.length > 0) {
                flatListRef.current?.scrollToEnd({ animated: true });
              }
            }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            testID="dashboard-chat-messages"
          />
        </View>
      ) : (
        <Pressable
          style={st.collapsedPreview}
          onPress={() => { setExpanded(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <View style={[st.avatar, { backgroundColor: P.mint + '20' }]}>
            <Ionicons name="sparkles" size={12} color={P.mint} />
          </View>
          <Text style={[st.previewText, { color: textPrimary }]} numberOfLines={2}>
            {allMessages[allMessages.length - 1]?.content || ''}
          </Text>
          <Ionicons name="chevron-down" size={16} color={textMuted} />
        </Pressable>
      )}

      <View style={[st.inputBar, { borderTopColor: cardBorder }]}>
        <TextInput
          style={[st.textInput, { backgroundColor: surfaceBg, color: textPrimary }]}
          placeholder="Ask your marketing agent..."
          placeholderTextColor={textMuted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => sendMessage()}
          multiline
          maxLength={2000}
          testID="dashboard-chat-input"
        />
        <Pressable
          style={[st.sendBtn, {
            backgroundColor: input.trim() && !sending ? P.mint : (isDark ? '#1A2030' : '#E2E8E4'),
          }]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || sending}
          testID="dashboard-chat-send"
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="arrow-up" size={18} color={input.trim() ? '#fff' : textMuted} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  connectedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectedDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerBtn: {
    padding: 4,
  },
  suggestionsWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  suggestionsLabel: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  suggestionsGrid: {
    gap: 6,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionText: {
    fontSize: 13,
    flex: 1,
  },
  messagesList: {
    padding: 12,
    paddingBottom: 4,
  },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
    gap: 6,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  msgText: {
    fontSize: 13,
    lineHeight: 19,
  },
  collapsedPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  previewText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 80,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
});
