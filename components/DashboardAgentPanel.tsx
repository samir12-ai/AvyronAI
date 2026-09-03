import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCampaign } from '@/context/CampaignContext';
import { authFetch, getApiUrl } from '@/lib/query-client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  actions?: Array<{ label: string; route: string }>;
}

function PulsingDot() {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <View style={styles.pulseContainer}>
      <Animated.View style={[styles.pulseRing, { opacity: anim }]} />
      <View style={styles.pulseCore} />
    </View>
  );
}

export function DashboardAgentPanel({ userName = 'there' }: { userName?: string }) {
  const router = useRouter();
  const { selectedCampaignId, selectedCampaign } = useCampaign();

  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');

  const scrollViewRef = useRef<ScrollView>(null);

  // Helper to format current time
  const getCurrentTime = () => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Reset conversation when campaign changes
  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setInputText('');
    setIsLoading(false);
    setHasError(false);
  }, [selectedCampaignId]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages, isLoading]);

  // Extract action deep-links from text if present
  const parseActionButtons = (text: string) => {
    const actions: Array<{ label: string; route: string }> = [];
    if (/strateg/i.test(text)) actions.push({ label: 'View Strategy', route: '/strategy' });
    if (/watchtower|competitor|market/i.test(text)) actions.push({ label: 'Open Watchtower', route: '/watchtower' });
    if (/today|task|priorit/i.test(text)) actions.push({ label: "Today's Tasks", route: '/wtdt' });
    if (/report|august|monthly/i.test(text)) actions.push({ label: 'Read Monthly Report', route: '/reports' });
    if (/creative|image|video|copy/i.test(text)) actions.push({ label: 'Creative Studio', route: '/create' });
    return actions.slice(0, 2);
  };

  // Send message handler
  const handleSendMessage = async (textToSend?: string) => {
    const prompt = (textToSend || inputText).trim();
    if (!prompt || isLoading || !selectedCampaignId) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: prompt,
      time: getCurrentTime(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setLastPrompt(prompt);
    setIsLoading(true);
    setHasError(false);

    try {
      const res = await authFetch(`${getApiUrl()}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          campaignId: selectedCampaignId,
          conversationId,
        }),
      });

      const json = await res.json();

      if (json.success && json.response) {
        if (json.conversationId) setConversationId(json.conversationId);
        const actions = parseActionButtons(json.response);
        const botMsg: ChatMessage = {
          id: `bot_${Date.now()}`,
          role: 'assistant',
          content: json.response,
          time: getCurrentTime(),
          actions,
        };
        setMessages(prev => [...prev, botMsg]);
      } else {
        setHasError(true);
      }
    } catch (err) {
      console.warn('[DashboardAgentPanel] chat error:', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Enter-key handler on desktop/web
  const handleKeyPress = (e: any) => {
    if (Platform.OS === 'web') {
      if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    }
  };

  const suggestedPrompts = [
    { label: 'What should I focus on today?', icon: 'compass' },
    { label: 'How are we performing against plan?', icon: 'trending-up' },
    { label: 'What changed in the market?', icon: 'eye' },
    { label: 'Explain my current strategy.', icon: 'shield' },
  ];

  return (
    <View style={[styles.aiPanelCard, isMinimized && styles.aiPanelCardMinimized]}>
      {/* Header */}
      <View style={styles.aiPanelHeader}>
        <View style={styles.aiPanelTitleRow}>
          <Feather name="zap" size={16} color="#A78BFA" />
          <Text style={styles.aiPanelTitle}>AVYRON AI</Text>
          <View style={styles.statusBadge}>
            <PulsingDot />
            <Text style={styles.statusBadgeText} numberOfLines={1}>
              {selectedCampaign?.selectedCampaignName || 'Active'}
            </Text>
          </View>
        </View>

        <View style={styles.aiPanelControls}>
          {messages.length > 0 && !isMinimized && (
            <Pressable style={styles.controlBtn} onPress={() => setMessages([])}>
              <Feather name="trash-2" size={13} color="#64748B" />
            </Pressable>
          )}
          <Pressable style={styles.controlBtn} onPress={() => setIsMinimized(!isMinimized)}>
            <Feather name={isMinimized ? 'maximize-2' : 'minus'} size={14} color="#94A3B8" />
          </Pressable>
        </View>
      </View>

      {!isMinimized && (
        <>
          {/* Scrollable Conversation Body */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContentContainer}
          >
            {/* Default Greeting */}
            <View style={styles.aiMessageBubble}>
              <View style={styles.aiSparkleIcon}>
                <Feather name="zap" size={14} color="#8B5CF6" />
              </View>
              <View style={styles.aiMessageTextContainer}>
                <Text style={styles.aiMessageGreeting}>Hi {userName}! I'm Avyron.</Text>
                <Text style={styles.aiMessageQuestion}>
                  I'm grounded in {selectedCampaign?.selectedCampaignName || 'your campaign'}'s strategy, market intelligence, and daily tasks. How can I help you today?
                </Text>
              </View>
            </View>

            {/* Conversation Messages */}
            {messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <View key={m.id} style={[styles.messageRow, isUser && styles.messageRowUser]}>
                  {!isUser && (
                    <View style={styles.avatarBox}>
                      <Feather name="zap" size={12} color="#8B5CF6" />
                    </View>
                  )}
                  <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
                    <Text style={[styles.bubbleText, isUser ? styles.userBubbleText : styles.botBubbleText]}>
                      {m.content}
                    </Text>

                    {/* Deep link action buttons */}
                    {m.actions && m.actions.length > 0 && (
                      <View style={styles.actionsRow}>
                        {m.actions.map((act) => (
                          <Pressable
                            key={act.label}
                            style={styles.actionChip}
                            onPress={() => router.push(act.route as any)}
                          >
                            <Feather name="arrow-up-right" size={11} color="#A78BFA" />
                            <Text style={styles.actionChipText}>{act.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}

                    <Text style={[styles.messageTime, isUser && { color: '#E2E8F0', opacity: 0.7 }]}>
                      {m.time}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* Loading Indicator */}
            {isLoading && (
              <View style={styles.loadingRow}>
                <View style={styles.avatarBox}>
                  <Feather name="zap" size={12} color="#8B5CF6" />
                </View>
                <View style={styles.loadingBubble}>
                  <ActivityIndicator size="small" color="#8B5CF6" />
                  <Text style={styles.loadingText}>Reviewing campaign intelligence...</Text>
                </View>
              </View>
            )}

            {/* Error & Retry Banner */}
            {hasError && (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={14} color="#EF4444" />
                <Text style={styles.errorText}>Avyron couldn't answer that right now.</Text>
                <Pressable style={styles.retryBtn} onPress={() => handleSendMessage(lastPrompt)}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>

          {/* Suggested Chips when Conversation is Fresh */}
          {messages.length === 0 && (
            <View style={styles.aiPromptSuggestions}>
              {suggestedPrompts.map((p) => (
                <Pressable
                  key={p.label}
                  style={styles.aiPromptChip}
                  onPress={() => handleSendMessage(p.label)}
                >
                  <Feather name={p.icon as any} size={12} color="#A78BFA" style={{ marginRight: 4 }} />
                  <Text style={styles.aiPromptChipText}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Composer / Input Row */}
          <View style={styles.aiInputRow}>
            <TextInput
              style={styles.aiTextInput}
              placeholder="Ask Avyron about your strategy, performance, market, or today's priorities..."
              placeholderTextColor="#64748B"
              value={inputText}
              onChangeText={setInputText}
              editable={!isLoading}
              onSubmitEditing={() => handleSendMessage()}
              onKeyPress={handleKeyPress}
              returnKeyType="send"
              multiline={false}
            />
            <Pressable
              style={[styles.aiSendBtn, (!inputText.trim() || isLoading) && styles.aiSendBtnDisabled]}
              onPress={() => handleSendMessage()}
              disabled={!inputText.trim() || isLoading}
            >
              <Feather name="send" size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  aiPanelCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 16,
    gap: 12,
  },
  aiPanelCardMinimized: {
    paddingBottom: 14,
  },
  aiPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiPanelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiPanelTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 11,
    color: '#10B981',
    fontWeight: '600',
    maxWidth: 120,
  },
  pulseContainer: {
    width: 12,
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
  },
  pulseCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  aiPanelControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  controlBtn: {
    padding: 4,
  },

  // Chat Body
  chatScroll: {
    maxHeight: 280,
  },
  chatContentContainer: {
    gap: 12,
    paddingBottom: 4,
  },
  aiMessageBubble: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0D131F',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1A2333',
  },
  aiSparkleIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiMessageTextContainer: {
    flex: 1,
  },
  aiMessageGreeting: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  aiMessageQuestion: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 17,
  },

  // Messages
  messageRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  avatarBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  bubble: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '85%',
  },
  userBubble: {
    backgroundColor: '#8B5CF6',
  },
  botBubble: {
    backgroundColor: '#0D131F',
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  bubbleText: {
    fontSize: 12,
    lineHeight: 18,
  },
  userBubbleText: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  botBubbleText: {
    color: '#E2E8F0',
  },
  messageTime: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 4,
    alignSelf: 'flex-end',
  },

  // Deep Link Action Chips
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E1838',
    borderWidth: 1,
    borderColor: '#382D5C',
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionChipText: {
    fontSize: 10,
    color: '#A78BFA',
    fontWeight: '600',
  },

  // Loading & Error States
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0D131F',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  loadingText: {
    fontSize: 11,
    color: '#A78BFA',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    fontSize: 11,
    color: '#EF4444',
    flex: 1,
  },
  retryBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  retryBtnText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // Suggestions
  aiPromptSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  aiPromptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D131F',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  aiPromptChipText: {
    fontSize: 11,
    color: '#CBD5E1',
  },

  // Input Box
  aiInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0B0F19',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1F293D',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  aiTextInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12,
    paddingVertical: 8,
  },
  aiSendBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiSendBtnDisabled: {
    backgroundColor: '#26334D',
    opacity: 0.6,
  },
});
