import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Alert,
  Animated,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCampaign } from '@/context/CampaignContext';
import { useAuth } from '@/context/AuthContext';
import { authFetch, getApiUrl } from '@/lib/query-client';

interface CampaignCreativeContext {
  campaign: {
    id: string;
    name: string;
    platform: string;
    goalType: string;
    location: string | null;
  };
  brandAssets: {
    logo: { id: string; url: string; name: string } | null;
    brandColors: string[];
    referenceImages: Array<{ id: string; url: string; name: string; assetType: string; role?: string }>;
  };
  productTruth: {
    name: string | null;
    type: string | null;
    coreProblemSolved: string | null;
    differentiatingFeature: string | null;
  };
  currentOffer: string | null;
  strategyDirection: string | null;
  activeLanes: Array<{ id: string; title: string }>;
  supportedChannels: string[];
  creativeQueue: Array<{
    id: string;
    title: string;
    priorityBadge: string;
    priorityColor: string;
    status: string;
    laneId: string;
    laneTitle: string;
    channel: string;
    format: string;
  }>;
}

interface CreativeAsset {
  id: string;
  generationType: 'IMAGE' | 'COPY' | 'VIDEO';
  platform: string;
  format: string;
  prompt: string;
  content?: string;
  mediaUrl?: string;
  createdAt: string;
  referenceAssetIds?: string[];
  metadata?: any;
}

interface BrandAssetItem {
  id: string;
  assetType: string;
  assetUrl: string;
  assetName: string;
  metadata?: any;
}

function PulsingGreenDot() {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0.4,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <View style={styles.pulseContainer}>
      <Animated.View style={[styles.pulseCircle, { opacity: anim }]} />
      <View style={styles.pulseDot} />
    </View>
  );
}

export default function CreativeStudioScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1080;
  const isTablet = width >= 768;

  const { selectedCampaignId, selectedCampaign } = useCampaign();
  const searchParams = useLocalSearchParams<{
    taskId?: string;
    laneId?: string;
    platform?: string;
    format?: string;
    goal?: string;
    brief?: string;
    tab?: string;
  }>();

  // Navigation Tabs: CREATE | LIBRARY | CREATIVE QUEUE
  const [activeNavTab, setActiveNavTab] = useState<'CREATE' | 'LIBRARY' | 'CREATIVE_QUEUE'>('CREATE');

  // Creation Sub-modes: WRITE | IMAGE | VIDEO
  const [studioMode, setStudioMode] = useState<'WRITE' | 'IMAGE' | 'VIDEO'>('IMAGE');

  // Context & Library State
  const [contextData, setContextData] = useState<CampaignCreativeContext | null>(null);
  const [libraryAssets, setLibraryAssets] = useState<CreativeAsset[]>([]);
  const [campaignBrandAssets, setCampaignBrandAssets] = useState<BrandAssetItem[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<'ALL' | 'IMAGE' | 'COPY' | 'VIDEO'>('ALL');
  const [loadingContext, setLoadingContext] = useState(true);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  // Campaign Library Picker Modal
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [libraryPickerTarget, setLibraryPickerTarget] = useState<'IMAGE_STUDIO' | 'VIDEO_STUDIO'>('IMAGE_STUDIO');

  // IMAGE STUDIO PRODUCT / REFERENCE IMAGE STATE
  const [selectedProductImage, setSelectedProductImage] = useState<{
    id?: string;
    url: string;
    name: string;
    role: string;
  } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // IMAGE STUDIO CONTROLS
  const [imagePlatform, setImagePlatform] = useState('Instagram');
  const [imageFormat, setImageFormat] = useState('Post');
  const [imageGoal, setImageGoal] = useState('Engagement');
  const [imageStyle, setImageStyle] = useState('Minimal');
  const [imageBrief, setImageBrief] = useState('');
  const [imageText, setImageText] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedImageSource, setGeneratedImageSource] = useState<string | null>(null);

  // WRITING STUDIO CONTROLS
  const [copyContentType, setCopyContentType] = useState('Post');
  const [copyPlatform, setCopyPlatform] = useState('Instagram');
  const [copyTone, setCopyTone] = useState('Punchy');
  const [copyGoal, setCopyGoal] = useState('Engagement');
  const [copyTopic, setCopyTopic] = useState('');
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState<string | null>(null);

  // VIDEO STUDIO CONTROLS
  const [videoMode, setVideoMode] = useState<'text-to-video' | 'image-to-video'>('text-to-video');
  const [videoStartingImage, setVideoStartingImage] = useState<{
    id?: string;
    url: string;
    name: string;
  } | null>(null);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoAspect, setVideoAspect] = useState('9:16');
  const [videoDuration, setVideoDuration] = useState('8s');
  const [videoResolution, setVideoResolution] = useState('720p');
  const [videoAudio, setVideoAudio] = useState(true);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [generatedVideoSource, setGeneratedVideoSource] = useState<string | null>(null);

  // Selected Task/Lane Lineage
  const [activeLaneId, setActiveLaneId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // Handle URL Handoff Params from WTDT
  useEffect(() => {
    if (searchParams.tab === 'library') setActiveNavTab('LIBRARY');
    if (searchParams.tab === 'queue') setActiveNavTab('CREATIVE_QUEUE');
    if (searchParams.tab === 'write') { setActiveNavTab('CREATE'); setStudioMode('WRITE'); }
    if (searchParams.tab === 'video') { setActiveNavTab('CREATE'); setStudioMode('VIDEO'); }
    if (searchParams.tab === 'image') { setActiveNavTab('CREATE'); setStudioMode('IMAGE'); }

    if (searchParams.platform) setImagePlatform(searchParams.platform);
    if (searchParams.format) setImageFormat(searchParams.format);
    if (searchParams.goal) setImageGoal(searchParams.goal);
    if (searchParams.brief) {
      setImageBrief(searchParams.brief);
      setCopyTopic(searchParams.brief);
      setVideoPrompt(searchParams.brief);
    }
    if (searchParams.laneId) setActiveLaneId(searchParams.laneId);
    if (searchParams.taskId) setActiveTaskId(searchParams.taskId);
  }, [searchParams]);

  // Fetch Creative Context strictly for current campaign
  const fetchCreativeContext = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      setLoadingContext(true);
      const res = await authFetch(`${getApiUrl()}/api/creative/context?campaignId=${selectedCampaignId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setContextData(json.data);
          if (!activeLaneId && json.data.activeLanes?.[0]) {
            setActiveLaneId(json.data.activeLanes[0].id);
          }
        }
      }
    } catch (err) {
      console.warn('[CreativeStudio] fetch context error:', err);
    } finally {
      setLoadingContext(false);
    }
  }, [selectedCampaignId, activeLaneId]);

  // Fetch Brand Assets for Campaign Library Picker
  const fetchCampaignBrandAssets = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const res = await authFetch(`${getApiUrl()}/api/creative/brand-assets?campaignId=${selectedCampaignId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.assets) {
          setCampaignBrandAssets(json.assets);
        }
      }
    } catch (err) {
      console.warn('[CreativeStudio] fetch brand assets error:', err);
    }
  }, [selectedCampaignId]);

  // Fetch Library Assets strictly for current campaign
  const fetchLibraryAssets = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      setLoadingLibrary(true);
      const url = `${getApiUrl()}/api/creative/library?campaignId=${selectedCampaignId}${libraryFilter !== 'ALL' ? `&type=${libraryFilter}` : ''}`;
      const res = await authFetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.assets) {
          setLibraryAssets(json.assets);
        }
      }
    } catch (err) {
      console.warn('[CreativeStudio] fetch library error:', err);
    } finally {
      setLoadingLibrary(false);
    }
  }, [selectedCampaignId, libraryFilter]);

  // Campaign Switch Safety: Clear all campaign-scoped state and refetch
  useEffect(() => {
    setSelectedProductImage(null);
    setVideoStartingImage(null);
    setGeneratedImage(null);
    setGeneratedImageSource(null);
    setGeneratedCopy(null);
    setGeneratedVideo(null);
    setGeneratedVideoSource(null);
    setContextData(null);
    setLibraryAssets([]);
    setCampaignBrandAssets([]);
    fetchCreativeContext();
    fetchLibraryAssets();
    fetchCampaignBrandAssets();
  }, [selectedCampaignId, fetchCreativeContext, fetchLibraryAssets, fetchCampaignBrandAssets]);

  // Image Upload Handler
  const handlePickAndUploadImage = async (target: 'IMAGE_STUDIO' | 'VIDEO_STUDIO') => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        setUploadingImage(true);

        const formData = new FormData();
        const filename = asset.fileName || `product_${Date.now()}.png`;
        
        if (Platform.OS === 'web') {
          const res = await fetch(asset.uri);
          const blob = await res.blob();
          formData.append('file', blob, filename);
        } else {
          formData.append('file', {
            uri: asset.uri,
            name: filename,
            type: asset.mimeType || 'image/png',
          } as any);
        }

        formData.append('assetType', 'PRODUCT_IMAGE');
        formData.append('assetName', filename);
        formData.append('role', 'PRIMARY_PRODUCT');

        const uploadRes = await authFetch(`${getApiUrl()}/api/creative/upload-asset?campaignId=${selectedCampaignId}`, {
          method: 'POST',
          body: formData,
        });

        const uploadJson = await uploadRes.json();
        if (uploadJson.success && uploadJson.asset) {
          const newAsset = {
            id: uploadJson.asset.id,
            url: uploadJson.asset.assetUrl.startsWith('http') ? uploadJson.asset.assetUrl : `${getApiUrl()}${uploadJson.asset.assetUrl}`,
            name: uploadJson.asset.assetName,
            role: 'PRIMARY_PRODUCT',
          };

          if (target === 'IMAGE_STUDIO') {
            setSelectedProductImage(newAsset);
          } else {
            setVideoStartingImage(newAsset);
          }
          fetchCampaignBrandAssets();
        } else {
          Alert.alert('Upload Failed', uploadJson.error || 'Failed to upload product image.');
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Image picker failed.');
    } finally {
      setUploadingImage(false);
    }
  };

  // 1. Generate Image Handler
  const handleGenerateImage = async () => {
    if (!imageBrief.trim()) {
      Alert.alert('Brief Required', 'Please enter a creative brief or description.');
      return;
    }
    try {
      setGeneratingImage(true);
      const res = await authFetch(`${getApiUrl()}/api/creative/generate-image?campaignId=${selectedCampaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imageBrief,
          format: imageFormat,
          platform: imagePlatform,
          style: imageStyle,
          goal: imageGoal,
          laneId: activeLaneId,
          taskId: activeTaskId,
          text: imageText,
          referenceAssetIds: selectedProductImage?.id ? [selectedProductImage.id] : [],
        }),
      });
      const json = await res.json();
      if (json.success && json.asset?.mediaUrl) {
        setGeneratedImage(json.asset.mediaUrl);
        setGeneratedImageSource(selectedProductImage?.url || null);
        fetchLibraryAssets();
      } else {
        Alert.alert('Generation Failed', json.error || 'Failed to generate image.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Image generation encountered an error.');
    } finally {
      setGeneratingImage(false);
    }
  };

  // 2. Generate Copy Handler
  const handleGenerateCopy = async () => {
    if (!copyTopic.trim()) {
      Alert.alert('Topic Required', 'Please enter a topic or copy instructions.');
      return;
    }
    try {
      setGeneratingCopy(true);
      const res = await authFetch(`${getApiUrl()}/api/creative/generate-copy?campaignId=${selectedCampaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: copyTopic,
          contentType: copyContentType,
          platform: copyPlatform,
          tone: copyTone,
          goal: copyGoal,
          laneId: activeLaneId,
          taskId: activeTaskId,
        }),
      });
      const json = await res.json();
      if (json.success && json.asset?.content) {
        setGeneratedCopy(json.asset.content);
        fetchLibraryAssets();
      } else {
        Alert.alert('Generation Failed', json.error || 'Failed to generate copy.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Copy generation encountered an error.');
    } finally {
      setGeneratingCopy(false);
    }
  };

  // 3. Generate Video Handler
  const handleGenerateVideo = async () => {
    if (videoMode === 'image-to-video' && !videoStartingImage?.id) {
      Alert.alert('Starting Image Required', 'Please select or upload a starting image for Image-to-Video generation.');
      return;
    }
    if (!videoPrompt.trim()) {
      Alert.alert('Prompt Required', 'Please enter a motion brief / video prompt.');
      return;
    }
    try {
      setGeneratingVideo(true);
      const res = await authFetch(`${getApiUrl()}/api/creative/generate-video?campaignId=${selectedCampaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: videoPrompt,
          mode: videoMode,
          aspect: videoAspect,
          duration: videoDuration,
          resolution: videoResolution,
          startingImageAssetId: videoStartingImage?.id || null,
          audio: videoAudio,
          laneId: activeLaneId,
          taskId: activeTaskId,
        }),
      });
      const json = await res.json();
      if (json.success && json.asset?.mediaUrl) {
        setGeneratedVideo(json.asset.mediaUrl);
        setGeneratedVideoSource(videoStartingImage?.url || null);
        fetchLibraryAssets();
      } else {
        Alert.alert('Generation Failed', json.error || 'Failed to generate video.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Video generation encountered an error.');
    } finally {
      setGeneratingVideo(false);
    }
  };

  // 4. Delete Library Item
  const handleDeleteLibraryItem = async (id: string) => {
    try {
      await authFetch(`${getApiUrl()}/api/creative/library/${id}?campaignId=${selectedCampaignId}`, {
        method: 'DELETE',
      });
      setLibraryAssets(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Delete item error:', err);
    }
  };

  // Helper for WTDT item click
  const handleStartQueueTask = (task: any) => {
    setActiveNavTab('CREATE');
    setActiveTaskId(task.id);
    setActiveLaneId(task.laneId);
    setImageBrief(task.title);
    setCopyTopic(task.title);
    if (task.format === 'Video') {
      setStudioMode('VIDEO');
      setVideoPrompt(task.title);
    } else if (task.channel === 'copy') {
      setStudioMode('WRITE');
    } else {
      setStudioMode('IMAGE');
    }
  };

  // Select item from Campaign Library Modal
  const handleSelectFromLibrary = (item: BrandAssetItem) => {
    const fullUrl = item.assetUrl.startsWith('http') ? item.assetUrl : `${getApiUrl()}${item.assetUrl}`;
    const selected = {
      id: item.id,
      url: fullUrl,
      name: item.assetName,
      role: (item.metadata as any)?.role || 'PRIMARY_PRODUCT',
    };

    if (libraryPickerTarget === 'IMAGE_STUDIO') {
      setSelectedProductImage(selected);
    } else {
      setVideoStartingImage(selected);
    }
    setShowLibraryPicker(false);
  };

  const platformsList = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'X'];
  const formatsList = [
    { id: 'Post', label: 'Post (1:1)' },
    { id: 'Story', label: 'Story (9:16)' },
    { id: 'Portrait', label: 'Portrait (4:5)' },
    { id: 'Landscape', label: 'Landscape (16:9)' },
  ];
  const goalsList = ['Awareness', 'Engagement', 'Lead Generation', 'Proof', 'Offer Promotion'];
  const stylesList = ['Minimal', 'Premium', 'Bold', 'Editorial', 'Product Focused', 'Lifestyle', 'Cinematic'];
  const tonesList = ['Punchy', 'Polished', 'Educational', 'Direct', 'Conversational'];
  const copyTypesList = ['Post', 'Caption', 'Ad Copy', 'Story', 'Video Script', 'Hook', 'Email'];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* 1. TOP HEADER */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.headerTitle}>CREATIVE STUDIO</Text>
          <Text style={styles.headerSubtitle}>
            Create campaign-ready content using your strategy, brand, and live market intelligence.
          </Text>
        </View>

        {/* TOP NAVIGATION: CREATE | LIBRARY | CREATIVE QUEUE */}
        <View style={styles.topNavTabs}>
          <Pressable
            style={[styles.navTab, activeNavTab === 'CREATE' && styles.navTabActive]}
            onPress={() => setActiveNavTab('CREATE')}
          >
            <Feather name="plus-circle" size={14} color={activeNavTab === 'CREATE' ? '#FFFFFF' : '#94A3B8'} />
            <Text style={[styles.navTabText, activeNavTab === 'CREATE' && styles.navTabTextActive]}>
              CREATE
            </Text>
          </Pressable>

          <Pressable
            style={[styles.navTab, activeNavTab === 'LIBRARY' && styles.navTabActive]}
            onPress={() => setActiveNavTab('LIBRARY')}
          >
            <Feather name="folder" size={14} color={activeNavTab === 'LIBRARY' ? '#FFFFFF' : '#94A3B8'} />
            <Text style={[styles.navTabText, activeNavTab === 'LIBRARY' && styles.navTabTextActive]}>
              LIBRARY ({libraryAssets.length})
            </Text>
          </Pressable>

          <Pressable
            style={[styles.navTab, activeNavTab === 'CREATIVE_QUEUE' && styles.navTabActive]}
            onPress={() => setActiveNavTab('CREATIVE_QUEUE')}
          >
            <Feather name="layers" size={14} color={activeNavTab === 'CREATIVE_QUEUE' ? '#FFFFFF' : '#94A3B8'} />
            <Text style={[styles.navTabText, activeNavTab === 'CREATIVE_QUEUE' && styles.navTabTextActive]}>
              CREATIVE QUEUE ({contextData?.creativeQueue?.length || 0})
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 2. MODE: CREATE */}
      {activeNavTab === 'CREATE' && (
        <View style={styles.createWrapper}>
          {/* Sub-mode Switcher Cards */}
          <View style={styles.modeCardsRow}>
            <Pressable
              style={[styles.modeCard, studioMode === 'WRITE' && styles.modeCardSelected]}
              onPress={() => setStudioMode('WRITE')}
            >
              <View style={[styles.modeIconBox, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                <Feather name="edit-3" size={18} color="#8B5CF6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>WRITE WITH AI</Text>
                <Text style={styles.modeDesc}>Hooks, captions, scripts, ads, and campaign copy.</Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.modeCard, studioMode === 'IMAGE' && styles.modeCardSelected]}
              onPress={() => setStudioMode('IMAGE')}
            >
              <View style={[styles.modeIconBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Feather name="image" size={18} color="#10B981" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>IMAGE STUDIO</Text>
                <Text style={styles.modeDesc}>Social posts, stories, ads, and campaign visuals.</Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.modeCard, studioMode === 'VIDEO' && styles.modeCardSelected]}
              onPress={() => setStudioMode('VIDEO')}
            >
              <View style={[styles.modeIconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Feather name="video" size={18} color="#3B82F6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>VIDEO STUDIO</Text>
                <Text style={styles.modeDesc}>Generate short-form video from text or images.</Text>
              </View>
            </Pressable>
          </View>

          {/* 3-PANEL WORKSPACE FOR IMAGE STUDIO */}
          {studioMode === 'IMAGE' && (
            <View style={[styles.workspaceLayout, !isDesktop && styles.workspaceLayoutStacked]}>
              {/* LEFT PANEL: CONTROLS */}
              <View style={styles.controlsPanel}>
                <Text style={styles.panelHeaderTitle}>Creative Controls</Text>

                {/* PRODUCT / REFERENCE IMAGE SECTION */}
                <View style={styles.fieldGroup}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.fieldLabel}>PRODUCT / REFERENCE IMAGE</Text>
                    <Text style={styles.fieldSubLabel}>What should Avyron design around?</Text>
                  </View>

                  {selectedProductImage ? (
                    <View style={styles.selectedAssetCard}>
                      <Image source={{ uri: selectedProductImage.url }} style={styles.selectedAssetThumb} resizeMode="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedAssetName} numberOfLines={1}>{selectedProductImage.name}</Text>
                        <View style={styles.roleBadge}>
                          <Text style={styles.roleBadgeText}>{selectedProductImage.role}</Text>
                        </View>
                      </View>
                      <View style={styles.assetActionButtons}>
                        <Pressable
                          style={styles.assetSmallBtn}
                          onPress={() => { setLibraryPickerTarget('IMAGE_STUDIO'); setShowLibraryPicker(true); }}
                        >
                          <Feather name="refresh-cw" size={12} color="#A78BFA" />
                          <Text style={styles.assetSmallBtnText}>Replace</Text>
                        </Pressable>
                        <Pressable
                          style={styles.assetDeleteSmallBtn}
                          onPress={() => setSelectedProductImage(null)}
                        >
                          <Feather name="x" size={14} color="#EF4444" />
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.imageUploadSlot}>
                      <Pressable
                        style={styles.uploadDropZone}
                        onPress={() => handlePickAndUploadImage('IMAGE_STUDIO')}
                        disabled={uploadingImage}
                      >
                        {uploadingImage ? (
                          <ActivityIndicator size="small" color="#8B5CF6" />
                        ) : (
                          <>
                            <Feather name="upload-cloud" size={20} color="#8B5CF6" />
                            <Text style={styles.uploadDropText}>Upload Product / Reference Image</Text>
                            <Text style={styles.uploadDropSubText}>PNG, JPG, WebP up to 15MB</Text>
                          </>
                        )}
                      </Pressable>

                      <Pressable
                        style={styles.chooseLibraryBtn}
                        onPress={() => { setLibraryPickerTarget('IMAGE_STUDIO'); setShowLibraryPicker(true); }}
                      >
                        <Feather name="folder" size={13} color="#A78BFA" />
                        <Text style={styles.chooseLibraryText}>Choose from Campaign Library</Text>
                      </Pressable>
                    </View>
                  )}
                </View>

                {/* Platform */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Platform</Text>
                  <View style={styles.pillRow}>
                    {platformsList.map(p => (
                      <Pressable
                        key={p}
                        style={[styles.pill, imagePlatform === p && styles.pillActive]}
                        onPress={() => setImagePlatform(p)}
                      >
                        <Text style={[styles.pillText, imagePlatform === p && styles.pillTextActive]}>{p}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Format */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Format</Text>
                  <View style={styles.pillRow}>
                    {formatsList.map(f => (
                      <Pressable
                        key={f.id}
                        style={[styles.pill, imageFormat === f.id && styles.pillActive]}
                        onPress={() => setImageFormat(f.id)}
                      >
                        <Text style={[styles.pillText, imageFormat === f.id && styles.pillTextActive]}>{f.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Creative Goal */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Creative Goal</Text>
                  <View style={styles.pillRow}>
                    {goalsList.map(g => (
                      <Pressable
                        key={g}
                        style={[styles.pill, imageGoal === g && styles.pillActive]}
                        onPress={() => setImageGoal(g)}
                      >
                        <Text style={[styles.pillText, imageGoal === g && styles.pillTextActive]}>{g}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Visual Style */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Visual Style</Text>
                  <View style={styles.pillRow}>
                    {stylesList.map(s => (
                      <Pressable
                        key={s}
                        style={[styles.pill, imageStyle === s && styles.pillActive]}
                        onPress={() => setImageStyle(s)}
                      >
                        <Text style={[styles.pillText, imageStyle === s && styles.pillTextActive]}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Creative Brief */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Creative Brief</Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder="Describe what Avyron should create (e.g. Place product in minimalist studio lighting with soft shadows)"
                    placeholderTextColor="#64748B"
                    multiline
                    numberOfLines={3}
                    value={imageBrief}
                    onChangeText={setImageBrief}
                  />
                </View>

                {/* Optional Overlay Text */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Overlay Text (Optional)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Save 10+ Hours Every Week"
                    placeholderTextColor="#64748B"
                    value={imageText}
                    onChangeText={setImageText}
                  />
                </View>

                {/* Generate Button */}
                <Pressable
                  style={[styles.generateBtn, generatingImage && styles.generateBtnDisabled]}
                  onPress={handleGenerateImage}
                  disabled={generatingImage}
                >
                  {generatingImage ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Feather name="sparkles" size={16} color="#FFFFFF" />
                      <Text style={styles.generateBtnText}>Generate Visual</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {/* CENTER PANEL: CANVAS & PREVIEW */}
              <View style={styles.canvasPanel}>
                <View style={styles.canvasHeader}>
                  <Text style={styles.canvasTitle}>Canvas Preview</Text>
                  <Text style={styles.canvasFormatBadge}>{imageFormat} · {imagePlatform}</Text>
                </View>

                {/* Source Product Badge if Selected */}
                {selectedProductImage && (
                  <View style={styles.designingAroundBadge}>
                    <Image source={{ uri: selectedProductImage.url }} style={styles.designingAroundThumb} resizeMode="cover" />
                    <Text style={styles.designingAroundText} numberOfLines={1}>
                      Designing around: <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{selectedProductImage.name}</Text>
                    </Text>
                  </View>
                )}

                {/* Source -> Generated Visual Comparison Banner */}
                {generatedImage && generatedImageSource && (
                  <View style={styles.lineageComparisonBanner}>
                    <View style={styles.comparisonItem}>
                      <Image source={{ uri: generatedImageSource }} style={styles.comparisonThumb} resizeMode="cover" />
                      <Text style={styles.comparisonLabel}>Source Product</Text>
                    </View>
                    <Feather name="arrow-right" size={14} color="#A78BFA" />
                    <View style={styles.comparisonItem}>
                      <Image source={{ uri: generatedImage }} style={styles.comparisonThumb} resizeMode="cover" />
                      <Text style={styles.comparisonLabel}>Generated Creative</Text>
                    </View>
                  </View>
                )}

                <View style={[
                  styles.canvasContainer,
                  imageFormat === 'Story' && styles.canvasStory,
                  imageFormat === 'Portrait' && styles.canvasPortrait,
                  imageFormat === 'Landscape' && styles.canvasLandscape,
                ]}>
                  {generatingImage ? (
                    <View style={styles.canvasLoadingBox}>
                      <ActivityIndicator size="large" color="#8B5CF6" />
                      <Text style={styles.canvasLoadingText}>
                        {selectedProductImage ? 'Integrating product into tailored scene...' : 'Creating your visual with campaign intelligence...'}
                      </Text>
                    </View>
                  ) : generatedImage ? (
                    <Image source={{ uri: generatedImage }} style={styles.canvasImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.canvasEmptyBox}>
                      <Feather name="image" size={36} color="#475569" style={{ marginBottom: 12 }} />
                      <Text style={styles.canvasEmptyTitle}>Your creative will appear here.</Text>
                      <Text style={styles.canvasEmptySub}>Configure controls on the left and click Generate.</Text>
                    </View>
                  )}
                </View>

                {generatedImage && (
                  <View style={styles.canvasActionsRow}>
                    <Pressable style={styles.canvasActionBtn} onPress={() => Alert.alert('Downloaded', 'Visual saved to your downloads.')}>
                      <Feather name="download" size={14} color="#FFFFFF" />
                      <Text style={styles.canvasActionText}>Download</Text>
                    </Pressable>
                    <Pressable style={styles.canvasActionSecondaryBtn} onPress={() => { setActiveNavTab('LIBRARY'); fetchLibraryAssets(); }}>
                      <Feather name="folder" size={14} color="#A78BFA" />
                      <Text style={styles.canvasActionSecondaryText}>View in Library</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {/* RIGHT PANEL: CAMPAIGN CONTEXT */}
              <View style={styles.contextPanel}>
                <View style={styles.contextHeader}>
                  <Feather name="shield" size={16} color="#8B5CF6" />
                  <Text style={styles.contextHeaderTitle}>CAMPAIGN CONTEXT</Text>
                </View>

                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Campaign</Text>
                  <Text style={styles.contextValue}>{selectedCampaign?.selectedCampaignName || contextData?.campaign?.name || 'Campaign'}</Text>
                </View>

                {/* Logo Section - Strictly Campaign Isolated */}
                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Campaign Logo</Text>
                  {contextData?.brandAssets?.logo ? (
                    <View style={styles.logoRow}>
                      <Image source={{ uri: contextData.brandAssets.logo.url }} style={styles.campaignLogoImg} resizeMode="contain" />
                      <Text style={styles.logoNameText}>{contextData.brandAssets.logo.name}</Text>
                    </View>
                  ) : (
                    <View style={styles.noLogoRow}>
                      <Text style={styles.noLogoText}>No logo added to this campaign.</Text>
                    </View>
                  )}
                </View>

                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Strategic Direction</Text>
                  <Text style={styles.contextValueSmall}>{contextData?.strategyDirection || 'Simplicity & Ease'}</Text>
                </View>

                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Current Offer</Text>
                  <Text style={styles.contextValueSmall}>{contextData?.currentOffer || 'Core Platform Trial'}</Text>
                </View>

                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Target Lane</Text>
                  <Text style={styles.contextValueSmall}>
                    {contextData?.activeLanes?.find(l => l.id === activeLaneId)?.title || contextData?.activeLanes?.[0]?.title || 'Simplified Scheduling for SMB Managers'}
                  </Text>
                </View>

                <View style={styles.isolationNoticeBox}>
                  <Feather name="lock" size={12} color="#10B981" />
                  <Text style={styles.isolationNoticeText}>
                    Branding and product assets are strictly isolated to this campaign.
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* WRITE WITH AI STUDIO */}
          {studioMode === 'WRITE' && (
            <View style={[styles.workspaceLayout, !isDesktop && styles.workspaceLayoutStacked]}>
              <View style={styles.controlsPanel}>
                <Text style={styles.panelHeaderTitle}>Writing Settings</Text>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Content Type</Text>
                  <View style={styles.pillRow}>
                    {copyTypesList.map(ct => (
                      <Pressable
                        key={ct}
                        style={[styles.pill, copyContentType === ct && styles.pillActive]}
                        onPress={() => setCopyContentType(ct)}
                      >
                        <Text style={[styles.pillText, copyContentType === ct && styles.pillTextActive]}>{ct}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Platform</Text>
                  <View style={styles.pillRow}>
                    {platformsList.map(p => (
                      <Pressable
                        key={p}
                        style={[styles.pill, copyPlatform === p && styles.pillActive]}
                        onPress={() => setCopyPlatform(p)}
                      >
                        <Text style={[styles.pillText, copyPlatform === p && styles.pillTextActive]}>{p}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Tone</Text>
                  <View style={styles.pillRow}>
                    {tonesList.map(t => (
                      <Pressable
                        key={t}
                        style={[styles.pill, copyTone === t && styles.pillActive]}
                        onPress={() => setCopyTone(t)}
                      >
                        <Text style={[styles.pillText, copyTone === t && styles.pillTextActive]}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Topic / Creative Brief</Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder="Describe what you want to write (e.g. 5 reasons why creators switch from manual scheduling)"
                    placeholderTextColor="#64748B"
                    multiline
                    numberOfLines={4}
                    value={copyTopic}
                    onChangeText={setCopyTopic}
                  />
                </View>

                <Pressable
                  style={[styles.generateBtn, generatingCopy && styles.generateBtnDisabled]}
                  onPress={handleGenerateCopy}
                  disabled={generatingCopy}
                >
                  {generatingCopy ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Feather name="edit-3" size={16} color="#FFFFFF" />
                      <Text style={styles.generateBtnText}>Generate Copy</Text>
                    </>
                  )}
                </Pressable>
              </View>

              <View style={styles.canvasPanel}>
                <View style={styles.canvasHeader}>
                  <Text style={styles.canvasTitle}>Generated Copy</Text>
                  <Text style={styles.canvasFormatBadge}>{copyContentType} · {copyPlatform}</Text>
                </View>

                <View style={styles.copyOutputContainer}>
                  {generatingCopy ? (
                    <View style={styles.canvasLoadingBox}>
                      <ActivityIndicator size="large" color="#8B5CF6" />
                      <Text style={styles.canvasLoadingText}>Writing direct-response copy aligned with strategy...</Text>
                    </View>
                  ) : generatedCopy ? (
                    <ScrollView style={styles.copyScroll}>
                      <Text style={styles.copyContentText}>{generatedCopy}</Text>
                    </ScrollView>
                  ) : (
                    <View style={styles.canvasEmptyBox}>
                      <Feather name="file-text" size={36} color="#475569" style={{ marginBottom: 12 }} />
                      <Text style={styles.canvasEmptyTitle}>Generated copy will appear here.</Text>
                      <Text style={styles.canvasEmptySub}>Select options on the left and click Generate Copy.</Text>
                    </View>
                  )}
                </View>

                {generatedCopy && (
                  <View style={styles.canvasActionsRow}>
                    <Pressable
                      style={styles.canvasActionBtn}
                      onPress={() => Alert.alert('Copied', 'Copy text copied to clipboard.')}
                    >
                      <Feather name="copy" size={14} color="#FFFFFF" />
                      <Text style={styles.canvasActionText}>Copy Text</Text>
                    </Pressable>
                    <Pressable
                      style={styles.canvasActionSecondaryBtn}
                      onPress={() => { setActiveNavTab('LIBRARY'); fetchLibraryAssets(); }}
                    >
                      <Feather name="folder" size={14} color="#A78BFA" />
                      <Text style={styles.canvasActionSecondaryText}>View in Library</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              <View style={styles.contextPanel}>
                <View style={styles.contextHeader}>
                  <Feather name="shield" size={16} color="#8B5CF6" />
                  <Text style={styles.contextHeaderTitle}>CAMPAIGN CONTEXT</Text>
                </View>
                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Campaign</Text>
                  <Text style={styles.contextValue}>{selectedCampaign?.selectedCampaignName || contextData?.campaign?.name || 'Campaign'}</Text>
                </View>
                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Strategic Direction</Text>
                  <Text style={styles.contextValueSmall}>{contextData?.strategyDirection || 'Simplicity & Ease'}</Text>
                </View>
                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Current Offer</Text>
                  <Text style={styles.contextValueSmall}>{contextData?.currentOffer || 'Core Platform Trial'}</Text>
                </View>
              </View>
            </View>
          )}

          {/* VIDEO STUDIO */}
          {studioMode === 'VIDEO' && (
            <View style={[styles.workspaceLayout, !isDesktop && styles.workspaceLayoutStacked]}>
              <View style={styles.controlsPanel}>
                <Text style={styles.panelHeaderTitle}>Video Controls</Text>

                {/* Sub-mode: Text to Video vs Image to Video */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Generation Mode</Text>
                  <View style={styles.pillRow}>
                    <Pressable
                      style={[styles.pill, videoMode === 'text-to-video' && styles.pillActive]}
                      onPress={() => setVideoMode('text-to-video')}
                    >
                      <Text style={[styles.pillText, videoMode === 'text-to-video' && styles.pillTextActive]}>Text to Video</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.pill, videoMode === 'image-to-video' && styles.pillActive]}
                      onPress={() => setVideoMode('image-to-video')}
                    >
                      <Text style={[styles.pillText, videoMode === 'image-to-video' && styles.pillTextActive]}>Image to Video</Text>
                    </Pressable>
                  </View>
                </View>

                {/* STARTING IMAGE SECTION (WHEN IN IMAGE TO VIDEO MODE) */}
                {videoMode === 'image-to-video' && (
                  <View style={styles.fieldGroup}>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.fieldLabel}>STARTING IMAGE / PRODUCT IMAGE</Text>
                      <Text style={[styles.fieldSubLabel, { color: '#EF4444' }]}>* Required</Text>
                    </View>

                    {videoStartingImage ? (
                      <View style={styles.selectedAssetCard}>
                        <Image source={{ uri: videoStartingImage.url }} style={styles.selectedAssetThumb} resizeMode="cover" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectedAssetName} numberOfLines={1}>{videoStartingImage.name}</Text>
                          <Text style={styles.startingImageTag}>Starting Frame</Text>
                        </View>
                        <View style={styles.assetActionButtons}>
                          <Pressable
                            style={styles.assetSmallBtn}
                            onPress={() => { setLibraryPickerTarget('VIDEO_STUDIO'); setShowLibraryPicker(true); }}
                          >
                            <Feather name="refresh-cw" size={12} color="#A78BFA" />
                            <Text style={styles.assetSmallBtnText}>Replace</Text>
                          </Pressable>
                          <Pressable
                            style={styles.assetDeleteSmallBtn}
                            onPress={() => setVideoStartingImage(null)}
                          >
                            <Feather name="x" size={14} color="#EF4444" />
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.imageUploadSlot}>
                        <Pressable
                          style={styles.uploadDropZone}
                          onPress={() => handlePickAndUploadImage('VIDEO_STUDIO')}
                          disabled={uploadingImage}
                        >
                          {uploadingImage ? (
                            <ActivityIndicator size="small" color="#8B5CF6" />
                          ) : (
                            <>
                              <Feather name="upload-cloud" size={20} color="#8B5CF6" />
                              <Text style={styles.uploadDropText}>Upload Starting Image</Text>
                              <Text style={styles.uploadDropSubText}>PNG, JPG up to 15MB</Text>
                            </>
                          )}
                        </Pressable>

                        <Pressable
                          style={styles.chooseLibraryBtn}
                          onPress={() => { setLibraryPickerTarget('VIDEO_STUDIO'); setShowLibraryPicker(true); }}
                        >
                          <Feather name="folder" size={13} color="#A78BFA" />
                          <Text style={styles.chooseLibraryText}>Choose from Campaign Library</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    {videoMode === 'image-to-video' ? 'Motion / Video Brief' : 'Video Prompt / Concept'}
                  </Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder={
                      videoMode === 'image-to-video'
                        ? 'Slow cinematic push-in, soft studio lighting, subtle product rotation, depth of field...'
                        : 'Describe the video scenes and camera motion (e.g. Dynamic product demo with smooth zooms)'
                    }
                    placeholderTextColor="#64748B"
                    multiline
                    numberOfLines={4}
                    value={videoPrompt}
                    onChangeText={setVideoPrompt}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Aspect Ratio</Text>
                  <View style={styles.pillRow}>
                    {['9:16', '16:9', '1:1'].map(a => (
                      <Pressable
                        key={a}
                        style={[styles.pill, videoAspect === a && styles.pillActive]}
                        onPress={() => setVideoAspect(a)}
                      >
                        <Text style={[styles.pillText, videoAspect === a && styles.pillTextActive]}>{a}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Duration</Text>
                  <View style={styles.pillRow}>
                    {['5s', '8s', '10s'].map(d => (
                      <Pressable
                        key={d}
                        style={[styles.pill, videoDuration === d && styles.pillActive]}
                        onPress={() => setVideoDuration(d)}
                      >
                        <Text style={[styles.pillText, videoDuration === d && styles.pillTextActive]}>{d}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <Pressable
                  style={[
                    styles.generateBtn,
                    (generatingVideo || (videoMode === 'image-to-video' && !videoStartingImage)) && styles.generateBtnDisabled,
                  ]}
                  onPress={handleGenerateVideo}
                  disabled={generatingVideo || (videoMode === 'image-to-video' && !videoStartingImage)}
                >
                  {generatingVideo ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Feather name="video" size={16} color="#FFFFFF" />
                      <Text style={styles.generateBtnText}>Generate Video</Text>
                    </>
                  )}
                </Pressable>

                {videoMode === 'image-to-video' && !videoStartingImage && (
                  <Text style={styles.validationWarningText}>
                    Please select a starting image above to enable video generation.
                  </Text>
                )}
              </View>

              <View style={styles.canvasPanel}>
                <View style={styles.canvasHeader}>
                  <Text style={styles.canvasTitle}>Video Preview</Text>
                  <Text style={styles.canvasFormatBadge}>{videoAspect} · Veo Engine</Text>
                </View>

                {/* Starting Frame -> Generated Video Comparison */}
                {generatedVideo && generatedVideoSource && (
                  <View style={styles.lineageComparisonBanner}>
                    <View style={styles.comparisonItem}>
                      <Image source={{ uri: generatedVideoSource }} style={styles.comparisonThumb} resizeMode="cover" />
                      <Text style={styles.comparisonLabel}>Starting Frame</Text>
                    </View>
                    <Feather name="arrow-right" size={14} color="#A78BFA" />
                    <View style={styles.comparisonItem}>
                      <View style={[styles.comparisonThumb, { backgroundColor: '#1E1838', justifyContent: 'center', alignItems: 'center' }]}>
                        <Feather name="play" size={12} color="#A78BFA" />
                      </View>
                      <Text style={styles.comparisonLabel}>Generated Video</Text>
                    </View>
                  </View>
                )}

                <View style={[styles.canvasContainer, styles.canvasStory]}>
                  {generatingVideo ? (
                    <View style={styles.canvasLoadingBox}>
                      <ActivityIndicator size="large" color="#8B5CF6" />
                      <Text style={styles.canvasLoadingText}>
                        {videoMode === 'image-to-video' ? 'Synthesizing product motion from starting frame...' : 'Synthesizing short-form video...'}
                      </Text>
                    </View>
                  ) : generatedVideo ? (
                    <View style={styles.videoPlayerShell}>
                      <Feather name="play-circle" size={48} color="#A78BFA" />
                      <Text style={styles.videoPlayerText}>Video Ready ({videoResolution} · {videoDuration})</Text>
                    </View>
                  ) : (
                    <View style={styles.canvasEmptyBox}>
                      <Feather name="film" size={36} color="#475569" style={{ marginBottom: 12 }} />
                      <Text style={styles.canvasEmptyTitle}>Your video preview will appear here.</Text>
                      <Text style={styles.canvasEmptySub}>Select starting image & motion brief to generate.</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.contextPanel}>
                <View style={styles.contextHeader}>
                  <Feather name="shield" size={16} color="#8B5CF6" />
                  <Text style={styles.contextHeaderTitle}>CAMPAIGN CONTEXT</Text>
                </View>
                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Campaign</Text>
                  <Text style={styles.contextValue}>{selectedCampaign?.selectedCampaignName || contextData?.campaign?.name || 'Campaign'}</Text>
                </View>
                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>Strategic Direction</Text>
                  <Text style={styles.contextValueSmall}>{contextData?.strategyDirection || 'Simplicity & Ease'}</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {/* 3. MODE: LIBRARY */}
      {activeNavTab === 'LIBRARY' && (
        <View style={styles.libraryContainer}>
          <View style={styles.libraryFilterRow}>
            {(['ALL', 'IMAGE', 'COPY', 'VIDEO'] as const).map(f => (
              <Pressable
                key={f}
                style={[styles.libraryFilterChip, libraryFilter === f && styles.libraryFilterChipActive]}
                onPress={() => setLibraryFilter(f)}
              >
                <Text style={[styles.libraryFilterText, libraryFilter === f && styles.libraryFilterTextActive]}>
                  {f === 'ALL' ? 'All Creatives' : f}
                </Text>
              </Pressable>
            ))}
          </View>

          {loadingLibrary ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text style={styles.loadingSub}>Loading campaign creatives...</Text>
            </View>
          ) : libraryAssets.length > 0 ? (
            <View style={styles.libraryGrid}>
              {libraryAssets.map(asset => (
                <View key={asset.id} style={styles.assetCard}>
                  <View style={styles.assetCardHeader}>
                    <View style={styles.assetTypeBadge}>
                      <Text style={styles.assetTypeBadgeText}>{asset.generationType}</Text>
                    </View>
                    <Text style={styles.assetPlatformText}>{asset.platform}</Text>
                  </View>

                  {asset.mediaUrl ? (
                    <Image source={{ uri: asset.mediaUrl }} style={styles.assetThumbnail} resizeMode="cover" />
                  ) : (
                    <View style={styles.assetCopyPreviewBox}>
                      <Text style={styles.assetCopyPreviewText} numberOfLines={4}>
                        {asset.content || asset.prompt}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.assetPromptTitle} numberOfLines={2}>{asset.prompt}</Text>

                  <View style={styles.assetCardActions}>
                    <Pressable
                      style={styles.assetActionBtn}
                      onPress={() => Alert.alert('Creative Asset', asset.content || asset.prompt)}
                    >
                      <Feather name="eye" size={14} color="#A78BFA" />
                      <Text style={styles.assetActionText}>Open</Text>
                    </Pressable>
                    <Pressable
                      style={styles.assetActionDeleteBtn}
                      onPress={() => handleDeleteLibraryItem(asset.id)}
                    >
                      <Feather name="trash-2" size={14} color="#EF4444" />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyStateContainer}>
              <Feather name="folder" size={36} color="#64748B" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyStateTitle}>Your generated creatives will appear here.</Text>
              <Text style={styles.emptyStateSub}>Generate images, copy, or video to build this campaign's asset library.</Text>
            </View>
          )}
        </View>
      )}

      {/* 4. MODE: CREATIVE QUEUE */}
      {activeNavTab === 'CREATIVE_QUEUE' && (
        <View style={styles.queueContainer}>
          <View style={styles.queueHeaderBox}>
            <Text style={styles.queueHeaderTitle}>WTDT Execution Requirements</Text>
            <Text style={styles.queueHeaderSub}>
              Tasks prioritized by your daily execution plan requiring creative assets.
            </Text>
          </View>

          {contextData?.creativeQueue && contextData.creativeQueue.length > 0 ? (
            <View style={styles.queueList}>
              {contextData.creativeQueue.map(item => (
                <View key={item.id} style={styles.queueItem}>
                  <View style={styles.queueItemLeft}>
                    <View style={[
                      styles.queueBadge,
                      { backgroundColor: item.priorityColor === 'red' ? 'rgba(239, 68, 68, 0.15)' : (item.priorityColor === 'orange' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.15)') }
                    ]}>
                      <Text style={[
                        styles.queueBadgeText,
                        { color: item.priorityColor === 'red' ? '#EF4444' : (item.priorityColor === 'orange' ? '#F59E0B' : '#3B82F6') }
                      ]}>
                        {item.priorityBadge}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.queueItemTitle}>{item.title}</Text>
                      <Text style={styles.queueItemMeta}>Lane: {item.laneTitle} · {item.channel}</Text>
                    </View>
                  </View>

                  <Pressable
                    style={styles.queueStartBtn}
                    onPress={() => handleStartQueueTask(item)}
                  >
                    <Feather name="arrow-right" size={14} color="#FFFFFF" />
                    <Text style={styles.queueStartText}>Create</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyStateContainer}>
              <PulsingGreenDot />
              <Text style={styles.emptyStateTitle}>You're clear for now.</Text>
              <Text style={styles.emptyStateSub}>No creative work is required from your current execution plan.</Text>
            </View>
          )}
        </View>
      )}

      {/* 5. CAMPAIGN LIBRARY PICKER MODAL */}
      <Modal visible={showLibraryPicker} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Campaign Asset Library</Text>
                <Text style={styles.modalSub}>Select a product or reference image for {selectedCampaign?.selectedCampaignName || 'this campaign'}</Text>
              </View>
              <Pressable style={styles.modalCloseBtn} onPress={() => setShowLibraryPicker(false)}>
                <Feather name="x" size={18} color="#94A3B8" />
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll}>
              {campaignBrandAssets.length > 0 ? (
                <View style={styles.modalGrid}>
                  {campaignBrandAssets.map(item => {
                    const fullUrl = item.assetUrl.startsWith('http') ? item.assetUrl : `${getApiUrl()}${item.assetUrl}`;
                    return (
                      <Pressable
                        key={item.id}
                        style={styles.modalAssetCard}
                        onPress={() => handleSelectFromLibrary(item)}
                      >
                        <Image source={{ uri: fullUrl }} style={styles.modalAssetThumb} resizeMode="cover" />
                        <Text style={styles.modalAssetName} numberOfLines={1}>{item.assetName}</Text>
                        <Text style={styles.modalAssetType}>{item.assetType}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.modalEmptyBox}>
                  <Feather name="image" size={32} color="#64748B" />
                  <Text style={styles.modalEmptyTitle}>No brand or product assets uploaded yet.</Text>
                  <Text style={styles.modalEmptySub}>Upload an image to start building your campaign asset library.</Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setShowLibraryPicker(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  contentContainer: {
    padding: 24,
    paddingBottom: 60,
  },
  topHeader: {
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 16,
  },
  topNavTabs: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  navTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  navTabActive: {
    backgroundColor: '#1E1838',
    borderColor: '#8B5CF6',
  },
  navTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  navTabTextActive: {
    color: '#FFFFFF',
  },

  // Sub-mode Switcher Cards
  createWrapper: {
    gap: 20,
  },
  modeCardsRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  modeCard: {
    flex: 1,
    minWidth: 240,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F293D',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  modeCardSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: '#17162E',
  },
  modeIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  modeDesc: {
    fontSize: 11,
    color: '#94A3B8',
  },

  // 3-Panel Workspace
  workspaceLayout: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'flex-start',
  },
  workspaceLayoutStacked: {
    flexDirection: 'column',
  },
  controlsPanel: {
    flex: 3,
    minWidth: 280,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F293D',
    gap: 16,
  },
  panelHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  fieldGroup: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  fieldSubLabel: {
    fontSize: 11,
    color: '#64748B',
  },

  // Product / Reference Image UI
  imageUploadSlot: {
    gap: 8,
  },
  uploadDropZone: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#382D5C',
    borderRadius: 8,
    backgroundColor: '#0E1320',
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  uploadDropText: {
    fontSize: 12,
    color: '#CBD5E1',
    fontWeight: '600',
  },
  uploadDropSubText: {
    fontSize: 10,
    color: '#64748B',
  },
  chooseLibraryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#151D2C',
    borderWidth: 1,
    borderColor: '#233047',
  },
  chooseLibraryText: {
    fontSize: 11,
    color: '#A78BFA',
    fontWeight: '600',
  },
  selectedAssetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0D131F',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#2A264D',
  },
  selectedAssetThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  selectedAssetName: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  roleBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  roleBadgeText: {
    fontSize: 9,
    color: '#A78BFA',
    fontWeight: '700',
  },
  startingImageTag: {
    fontSize: 10,
    color: '#10B981',
    fontWeight: '600',
  },
  assetActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assetSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1C1938',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  assetSmallBtnText: {
    fontSize: 10,
    color: '#A78BFA',
    fontWeight: '600',
  },
  assetDeleteSmallBtn: {
    padding: 4,
  },

  // Pills
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#182030',
    borderWidth: 1,
    borderColor: '#26334D',
  },
  pillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderColor: '#8B5CF6',
  },
  pillText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  textArea: {
    backgroundColor: '#0B0F19',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 12,
    color: '#FFFFFF',
    fontSize: 12,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  textInput: {
    backgroundColor: '#0B0F19',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1F293D',
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 12,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    borderRadius: 8,
    paddingVertical: 12,
    gap: 8,
    marginTop: 8,
  },
  generateBtnDisabled: {
    opacity: 0.5,
  },
  generateBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  validationWarningText: {
    fontSize: 11,
    color: '#F87171',
    textAlign: 'center',
  },

  // Center Canvas Panel
  canvasPanel: {
    flex: 4,
    minWidth: 320,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F293D',
    alignItems: 'center',
  },
  canvasHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  canvasTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  canvasFormatBadge: {
    fontSize: 11,
    color: '#A78BFA',
    fontWeight: '600',
  },
  designingAroundBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  designingAroundThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  designingAroundText: {
    fontSize: 11,
    color: '#CBD5E1',
  },
  lineageComparisonBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#0D131F',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  comparisonItem: {
    alignItems: 'center',
    gap: 4,
  },
  comparisonThumb: {
    width: 38,
    height: 38,
    borderRadius: 4,
  },
  comparisonLabel: {
    fontSize: 9,
    color: '#94A3B8',
    fontWeight: '600',
  },
  canvasContainer: {
    width: 280,
    height: 280,
    borderRadius: 12,
    backgroundColor: '#0B0F19',
    borderWidth: 1,
    borderColor: '#1F293D',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  canvasStory: {
    width: 220,
    height: 390,
  },
  canvasPortrait: {
    width: 240,
    height: 300,
  },
  canvasLandscape: {
    width: 320,
    height: 180,
  },
  canvasImage: {
    width: '100%',
    height: '100%',
  },
  canvasEmptyBox: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  canvasEmptyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E1',
    textAlign: 'center',
    marginBottom: 4,
  },
  canvasEmptySub: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
  },
  canvasLoadingBox: {
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  canvasLoadingText: {
    fontSize: 12,
    color: '#A78BFA',
    textAlign: 'center',
  },
  canvasActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    width: '100%',
    justifyContent: 'center',
  },
  canvasActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#8B5CF6',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  canvasActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  canvasActionSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#382D5C',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  canvasActionSecondaryText: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '600',
  },

  // Right Campaign Context Panel
  contextPanel: {
    flex: 2.5,
    minWidth: 240,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F293D',
    gap: 14,
  },
  contextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  contextHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A78BFA',
    letterSpacing: 0.5,
  },
  contextCard: {
    backgroundColor: '#0D131F',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1A2333',
  },
  contextLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  contextValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  contextValueSmall: {
    fontSize: 12,
    color: '#E2E8F0',
    lineHeight: 16,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  campaignLogoImg: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  logoNameText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  noLogoRow: {
    paddingVertical: 2,
  },
  noLogoText: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },
  isolationNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  isolationNoticeText: {
    fontSize: 10,
    color: '#10B981',
    flex: 1,
  },

  // Copy Canvas Specifics
  copyOutputContainer: {
    width: '100%',
    minHeight: 280,
    borderRadius: 12,
    backgroundColor: '#0B0F19',
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 16,
    justifyContent: 'center',
  },
  copyScroll: {
    maxHeight: 320,
  },
  copyContentText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 20,
  },

  // Video Specifics
  videoPlayerShell: {
    alignItems: 'center',
    gap: 12,
  },
  videoPlayerText: {
    fontSize: 12,
    color: '#CBD5E1',
  },

  // Library Mode Styles
  libraryContainer: {
    gap: 20,
  },
  libraryFilterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  libraryFilterChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  libraryFilterChipActive: {
    backgroundColor: '#1E1838',
    borderColor: '#8B5CF6',
  },
  libraryFilterText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  libraryFilterTextActive: {
    color: '#FFFFFF',
  },
  libraryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  assetCard: {
    width: 240,
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 12,
    gap: 10,
  },
  assetCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assetTypeBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  assetTypeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A78BFA',
  },
  assetPlatformText: {
    fontSize: 11,
    color: '#64748B',
  },
  assetThumbnail: {
    width: '100%',
    height: 140,
    borderRadius: 6,
  },
  assetCopyPreviewBox: {
    height: 140,
    backgroundColor: '#0B0F19',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1A2333',
  },
  assetCopyPreviewText: {
    fontSize: 11,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  assetPromptTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  assetCardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  assetActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  assetActionText: {
    fontSize: 11,
    color: '#A78BFA',
    fontWeight: '600',
  },
  assetActionDeleteBtn: {
    padding: 4,
  },

  // Creative Queue Styles
  queueContainer: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1F293D',
    gap: 20,
  },
  queueHeaderBox: {
    marginBottom: 4,
  },
  queueHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  queueHeaderSub: {
    fontSize: 12,
    color: '#94A3B8',
  },
  queueList: {
    gap: 12,
  },
  queueItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0D131F',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  queueItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  queueBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  queueBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  queueItemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  queueItemMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  queueStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#8B5CF6',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  queueStartText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Campaign Library Picker Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '80%',
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  modalSub: {
    fontSize: 12,
    color: '#94A3B8',
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  modalAssetCard: {
    width: 135,
    backgroundColor: '#0B0F19',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#1F293D',
    gap: 6,
  },
  modalAssetThumb: {
    width: '100%',
    height: 100,
    borderRadius: 6,
  },
  modalAssetName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalAssetType: {
    fontSize: 9,
    color: '#A78BFA',
    fontWeight: '600',
  },
  modalEmptyBox: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  modalEmptyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  modalEmptySub: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  modalCancelText: {
    fontSize: 12,
    color: '#CBD5E1',
    fontWeight: '600',
  },

  // Generic Empty & Loading States
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyStateSub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingSub: {
    fontSize: 12,
    color: '#94A3B8',
  },
  pulseContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    position: 'relative',
  },
  pulseCircle: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
});
