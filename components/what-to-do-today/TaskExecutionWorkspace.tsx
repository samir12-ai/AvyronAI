import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ExecutionTaskItem } from '@/hooks/useWhatToDoToday';
import { apiRequest, safeApiJson } from '@/lib/query-client';

export interface ProductionScene {
  sceneNumber: number;
  phase: string;
  timestamp: string;
  durationSeconds: number;
  shootingAngle: string;
  visualCue: string;
  spokenScript: string;
  onScreenText: string;
  soundCue?: string;
}

export interface CarouselSlide {
  slideNumber: number;
  headline: string;
  subhead?: string;
  visualPrompt: string;
  bodyCopy: string;
  onScreenElements: string[];
  swipeCta?: string;
}

export interface PlatformPostCopy {
  postTitle?: string;
  caption: string;
  hashtags: string[];
  firstComment?: string;
  ctaLinkText: string;
  ctaUrl: string;
  thumbnailHookText?: string;
}

export interface TaskProductionBlueprint {
  taskId: string;
  taskTitle: string;
  channel: string;
  channelRole: string;
  targetFormat: string;
  estimatedTotalDuration: string;
  aspectRatio: string;
  strategicIntent: string;
  keyTakeaway: string;
  scenes: ProductionScene[];
  carouselSlides?: CarouselSlide[];
  platformPost: PlatformPostCopy;
  teleprompterFullScript: string;
  productionChecklist: Array<{ step: string; isCompleted: boolean }>;
  generatedAt: string;
}

interface TaskExecutionWorkspaceProps {
  task: ExecutionTaskItem;
  onBack: () => void;
  onUpdateStatus: (taskId: string, status: ExecutionTaskItem['status']) => Promise<void>;
}

export function TaskExecutionWorkspace({ task, onBack, onUpdateStatus }: TaskExecutionWorkspaceProps) {
  const [blueprint, setBlueprint] = useState<TaskProductionBlueprint | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'scenes' | 'teleprompter' | 'platform' | 'checklist'>('scenes');
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [checklist, setChecklist] = useState<Array<{ step: string; isCompleted: boolean }>>([]);

  const isDone = task.status === 'DONE';
  const isActive = task.status === 'ACTIVE';

  const fetchBlueprint = async (force: boolean = false) => {
    try {
      if (force) setRegenerating(true);
      else setLoading(true);
      setError(null);

      const endpoint = force
        ? `/api/what-to-do-today/tasks/${task.id}/blueprint/generate`
        : `/api/what-to-do-today/tasks/${task.id}/blueprint`;

      const res = await apiRequest(force ? 'POST' : 'GET', endpoint);
      const data = await safeApiJson(res);

      if (data?.blueprint) {
        setBlueprint(data.blueprint);
        setChecklist(data.blueprint.productionChecklist || []);
      } else {
        setError('Failed to load production blueprint.');
      }
    } catch (err: any) {
      setError(err.message || 'Error generating production script.');
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  useEffect(() => {
    fetchBlueprint(false);
  }, [task.id]);

  const copyToClipboard = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2500);
    }
  };

  const toggleChecklistItem = (index: number) => {
    const next = [...checklist];
    next[index].isCompleted = !next[index].isCompleted;
    setChecklist(next);
  };

  const getChannelIcon = (ch: string) => {
    switch (ch.toUpperCase()) {
      case 'YOUTUBE': return 'video';
      case 'INSTAGRAM': return 'instagram';
      case 'TIKTOK': return 'film';
      case 'FACEBOOK': return 'facebook';
      case 'X': return 'twitter';
      default: return 'globe';
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Action Bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Feather name="arrow-left" size={18} color="#F8FAFC" />
          <Text style={styles.backBtnText}>Back to Today's Tasks</Text>
        </Pressable>

        <View style={styles.topBarRight}>
          <View style={styles.channelBadge}>
            <Feather
              name={getChannelIcon(task.channel) as any}
              size={13}
              color={task.channelRole === 'PRIMARY' ? '#C4B5FD' : '#94A3B8'}
            />
            <Text style={styles.channelBadgeText}>{task.channel} • {task.channelRole}</Text>
          </View>

          <Pressable
            style={[styles.statusBtn, isDone ? styles.statusBtnDone : styles.statusBtnActive]}
            onPress={() => onUpdateStatus(task.id, isDone ? 'ACTIVE' : 'DONE')}
          >
            <Feather name={isDone ? 'check-circle' : 'play-circle'} size={15} color="#FFFFFF" />
            <Text style={styles.statusBtnText}>{isDone ? 'Mark as Active' : 'Mark as Done'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Main Studio Scroll Area */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {/* Studio Hero Header */}
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <View style={styles.heroLeft}>
              <View style={styles.specRibbon}>
                <View style={styles.specPill}>
                  <Feather name="film" size={11} color="#A78BFA" />
                  <Text style={styles.specPillText}>{blueprint?.targetFormat || `${task.channel} Production Asset`}</Text>
                </View>
                {blueprint?.aspectRatio && (
                  <View style={styles.specPill}>
                    <Feather name="maximize-2" size={11} color="#34D399" />
                    <Text style={styles.specPillText}>Aspect Ratio: {blueprint.aspectRatio}</Text>
                  </View>
                )}
                {blueprint?.estimatedTotalDuration && (
                  <View style={styles.specPill}>
                    <Feather name="clock" size={11} color="#FCD34D" />
                    <Text style={styles.specPillText}>Duration: {blueprint.estimatedTotalDuration}</Text>
                  </View>
                )}
              </View>

              <Text style={styles.taskHeroTitle}>{task.title}</Text>
              <Text style={styles.taskHeroDescription}>{task.description}</Text>
            </View>

            <Pressable
              style={styles.regenerateBtn}
              onPress={() => fetchBlueprint(true)}
              disabled={regenerating}
            >
              {regenerating ? (
                <ActivityIndicator size="small" color="#A78BFA" />
              ) : (
                <Feather name="refresh-cw" size={14} color="#A78BFA" />
              )}
              <Text style={styles.regenerateBtnText}>
                {regenerating ? 'Regenerating…' : 'Regenerate Script'}
              </Text>
            </Pressable>
          </View>

          {/* Strategic Intent & Key Takeaway */}
          {blueprint && (
            <View style={styles.strategicGrid}>
              <View style={styles.strategicBox}>
                <Text style={styles.strategicBoxLabel}>STRATEGIC INTENT</Text>
                <Text style={styles.strategicBoxValue}>{blueprint.strategicIntent}</Text>
              </View>
              <View style={styles.strategicBox}>
                <Text style={styles.strategicBoxLabel}>CORE VIEWER TAKEAWAY</Text>
                <Text style={styles.strategicBoxValue}>{blueprint.keyTakeaway}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabNav}>
          <Pressable
            style={[styles.tabItem, activeTab === 'scenes' && styles.tabItemActive]}
            onPress={() => setActiveTab('scenes')}
          >
            <Feather name="video" size={15} color={activeTab === 'scenes' ? '#8B5CF6' : '#94A3B8'} />
            <Text style={[styles.tabItemText, activeTab === 'scenes' && styles.tabItemTextActive]}>
              Shooting Blueprint ({blueprint?.scenes?.length || 0} Scenes)
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tabItem, activeTab === 'teleprompter' && styles.tabItemActive]}
            onPress={() => setActiveTab('teleprompter')}
          >
            <Feather name="file-text" size={15} color={activeTab === 'teleprompter' ? '#8B5CF6' : '#94A3B8'} />
            <Text style={[styles.tabItemText, activeTab === 'teleprompter' && styles.tabItemTextActive]}>
              Teleprompter / Full Script
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tabItem, activeTab === 'platform' && styles.tabItemActive]}
            onPress={() => setActiveTab('platform')}
          >
            <Feather name="share" size={15} color={activeTab === 'platform' ? '#8B5CF6' : '#94A3B8'} />
            <Text style={[styles.tabItemText, activeTab === 'platform' && styles.tabItemTextActive]}>
              Platform Copy & CTA
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tabItem, activeTab === 'checklist' && styles.tabItemActive]}
            onPress={() => setActiveTab('checklist')}
          >
            <Feather name="check-square" size={15} color={activeTab === 'checklist' ? '#8B5CF6' : '#94A3B8'} />
            <Text style={[styles.tabItemText, activeTab === 'checklist' && styles.tabItemTextActive]}>
              Production Checklist
            </Text>
          </Pressable>
        </View>

        {/* Loading State */}
        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingBoxText}>Generating broadcast shooting script with strategy grounding…</Text>
          </View>
        )}

        {/* Error State */}
        {error && !loading && (
          <View style={styles.errorBox}>
            <Feather name="alert-triangle" size={24} color="#EF4444" />
            <Text style={styles.errorBoxText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => fetchBlueprint(true)}>
              <Text style={styles.retryBtnText}>Retry Generation</Text>
            </Pressable>
          </View>
        )}

        {/* TAB 1: SCENE-BY-SCENE SHOOTING SCRIPT */}
        {!loading && !error && activeTab === 'scenes' && blueprint && (
          <View style={styles.scenesContainer}>
            {blueprint.scenes.map((scene) => (
              <View key={scene.sceneNumber} style={styles.sceneCard}>
                {/* Scene Header */}
                <View style={styles.sceneCardHeader}>
                  <View style={styles.sceneHeaderLeft}>
                    <View style={styles.sceneNumberBadge}>
                      <Text style={styles.sceneNumberText}>SCENE {scene.sceneNumber}</Text>
                    </View>
                    <View style={styles.phaseBadge}>
                      <Text style={styles.phaseBadgeText}>{scene.phase.replace('_', ' ')}</Text>
                    </View>
                  </View>

                  <View style={styles.timestampBadge}>
                    <Feather name="clock" size={12} color="#CBD5E1" />
                    <Text style={styles.timestampText}>{scene.timestamp} ({scene.durationSeconds}s)</Text>
                  </View>
                </View>

                {/* Director Camera & Visual Cues */}
                <View style={styles.directionRow}>
                  <View style={styles.directionBox}>
                    <View style={styles.directionHeader}>
                      <Feather name="camera" size={13} color="#8B5CF6" />
                      <Text style={styles.directionLabel}>SHOOTING ANGLE & FRAMING</Text>
                    </View>
                    <Text style={styles.directionText}>{scene.shootingAngle}</Text>
                  </View>

                  <View style={styles.directionBox}>
                    <View style={styles.directionHeader}>
                      <Feather name="eye" size={13} color="#34D399" />
                      <Text style={styles.directionLabel}>VISUAL CUE & B-ROLL ACTION</Text>
                    </View>
                    <Text style={styles.directionText}>{scene.visualCue}</Text>
                  </View>
                </View>

                {/* Spoken Dialogue (A-Roll) */}
                <View style={styles.scriptBox}>
                  <View style={styles.scriptBoxHeader}>
                    <Feather name="mic" size={14} color="#FCD34D" />
                    <Text style={styles.scriptBoxLabel}>SPOKEN DIALOGUE (WORD-FOR-WORD)</Text>
                  </View>
                  <Text style={styles.spokenScriptText}>"{scene.spokenScript}"</Text>
                </View>

                {/* On-Screen Text Graphic */}
                {scene.onScreenText ? (
                  <View style={styles.ostBox}>
                    <Feather name="type" size={13} color="#A78BFA" />
                    <Text style={styles.ostLabel}>ON-SCREEN TEXT:</Text>
                    <Text style={styles.ostValue}>{scene.onScreenText}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* TAB 2: TELEPROMPTER / CONTINUOUS SCRIPT */}
        {!loading && !error && activeTab === 'teleprompter' && blueprint && (
          <View style={styles.teleprompterCard}>
            <View style={styles.teleprompterHeader}>
              <View>
                <Text style={styles.teleprompterTitle}>Full Recording Script</Text>
                <Text style={styles.teleprompterSubtitle}>Read continuously or paste into teleprompter software</Text>
              </View>

              <Pressable
                style={[styles.copyBtn, copiedScript && styles.copyBtnSuccess]}
                onPress={() => copyToClipboard(blueprint.teleprompterFullScript)}
              >
                <Feather name={copiedScript ? 'check' : 'copy'} size={14} color="#FFFFFF" />
                <Text style={styles.copyBtnText}>{copiedScript ? 'Copied to Clipboard!' : 'Copy Full Script'}</Text>
              </Pressable>
            </View>

            <View style={styles.teleprompterBody}>
              <Text style={styles.teleprompterText}>{blueprint.teleprompterFullScript}</Text>
            </View>
          </View>
        )}

        {/* TAB 3: PLATFORM POST & DISTRIBUTION COPY */}
        {!loading && !error && activeTab === 'platform' && blueprint && (
          <View style={styles.platformCard}>
            <View style={styles.platformSection}>
              <Text style={styles.platformSectionLabel}>SEO-OPTIMIZED POST TITLE</Text>
              <Text style={styles.platformTitleText}>{blueprint.platformPost.postTitle || task.title}</Text>
            </View>

            <View style={styles.platformSection}>
              <View style={styles.platformSectionHeader}>
                <Text style={styles.platformSectionLabel}>POST CAPTION & COPY</Text>
                <Pressable
                  style={styles.copySmallBtn}
                  onPress={() => copyToClipboard(blueprint.platformPost.caption)}
                >
                  <Feather name="copy" size={12} color="#A78BFA" />
                  <Text style={styles.copySmallBtnText}>Copy Caption</Text>
                </Pressable>
              </View>
              <View style={styles.captionBox}>
                <Text style={styles.captionText}>{blueprint.platformPost.caption}</Text>
              </View>
            </View>

            <View style={styles.platformSection}>
              <Text style={styles.platformSectionLabel}>RECOMMENDED HASHTAGS</Text>
              <View style={styles.hashtagRow}>
                {blueprint.platformPost.hashtags?.map((tag, i) => (
                  <View key={i} style={styles.hashtagPill}>
                    <Text style={styles.hashtagText}>{tag.startsWith('#') ? tag : `#${tag}`}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.platformSection}>
              <Text style={styles.platformSectionLabel}>DESTINATION CTA LINK</Text>
              <View style={styles.ctaDestinationBox}>
                <Feather name="link" size={14} color="#34D399" />
                <Text style={styles.ctaDestinationUrl}>{blueprint.platformPost.ctaUrl}</Text>
              </View>
            </View>
          </View>
        )}

        {/* TAB 4: PRODUCTION CHECKLIST */}
        {!loading && !error && activeTab === 'checklist' && (
          <View style={styles.checklistCard}>
            <Text style={styles.checklistHeaderTitle}>Production Stage Checklist</Text>
            <Text style={styles.checklistHeaderSubtitle}>Track your recording and editing progress</Text>

            <View style={styles.checklistGrid}>
              {checklist.map((item, idx) => (
                <Pressable
                  key={idx}
                  style={[styles.checklistItem, item.isCompleted && styles.checklistItemCompleted]}
                  onPress={() => toggleChecklistItem(idx)}
                >
                  <Feather
                    name={item.isCompleted ? 'check-circle' : 'circle'}
                    size={20}
                    color={item.isCompleted ? '#10B981' : '#64748B'}
                  />
                  <Text style={[styles.checklistText, item.isCompleted && styles.checklistTextCompleted]}>
                    {item.step}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    flexWrap: 'wrap',
    gap: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  channelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  channelBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  statusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusBtnActive: {
    backgroundColor: '#10B981',
  },
  statusBtnDone: {
    backgroundColor: '#64748B',
  },
  statusBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
  },
  heroCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 16,
  },
  heroLeft: {
    flex: 1,
    minWidth: 280,
  },
  specRibbon: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  specPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  specPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  taskHeroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F8FAFC',
    lineHeight: 28,
    marginBottom: 6,
  },
  taskHeroDescription: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 20,
  },
  regenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  regenerateBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  strategicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
  },
  strategicBox: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  strategicBoxLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8B5CF6',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  strategicBoxValue: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 18,
  },
  tabNav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tabItemActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderColor: '#8B5CF6',
  },
  tabItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  tabItemTextActive: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  loadingBox: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  loadingBoxText: {
    fontSize: 14,
    color: '#CBD5E1',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    gap: 10,
  },
  errorBoxText: {
    fontSize: 14,
    color: '#FCA5A5',
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  scenesContainer: {
    gap: 16,
  },
  sceneCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sceneCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  sceneHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sceneNumberBadge: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sceneNumberText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  phaseBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  phaseBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  timestampBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  timestampText: {
    fontSize: 12,
    color: '#CBD5E1',
    fontWeight: '600',
  },
  directionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  directionBox: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  directionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  directionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  directionText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 18,
  },
  scriptBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    marginBottom: 10,
  },
  scriptBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  scriptBoxLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.5,
  },
  spokenScriptText: {
    fontSize: 15,
    color: '#F8FAFC',
    lineHeight: 22,
    fontWeight: '500',
  },
  ostBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  ostLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  ostValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  teleprompterCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  teleprompterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 14,
  },
  teleprompterTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  teleprompterSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  copyBtnSuccess: {
    backgroundColor: '#10B981',
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  teleprompterBody: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  teleprompterText: {
    fontSize: 17,
    color: '#F8FAFC',
    lineHeight: 28,
  },
  platformCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 18,
  },
  platformSection: {
    gap: 8,
  },
  platformSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  platformSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8B5CF6',
    letterSpacing: 0.5,
  },
  platformTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  copySmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  copySmallBtnText: {
    fontSize: 12,
    color: '#C4B5FD',
    fontWeight: '600',
  },
  captionBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  captionText: {
    fontSize: 14,
    color: '#E2E8F0',
    lineHeight: 21,
  },
  hashtagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hashtagPill: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  hashtagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  ctaDestinationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  ctaDestinationUrl: {
    fontSize: 13,
    color: '#34D399',
    fontWeight: '600',
  },
  checklistCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  checklistHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  checklistHeaderSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 16,
  },
  checklistGrid: {
    gap: 10,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0F172A',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  checklistItemCompleted: {
    borderColor: '#059669',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  checklistText: {
    fontSize: 14,
    color: '#E2E8F0',
    flex: 1,
  },
  checklistTextCompleted: {
    textDecorationLine: 'line-through',
    color: '#6EE7B7',
  },
});
