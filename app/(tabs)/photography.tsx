import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Platform,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  FlatList,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';
import { getApiUrl } from '@/lib/query-client';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 52) / 2;

type UserRole = 'none' | 'photographer' | 'customer';

interface Photographer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  bio?: string;
  specialties?: string;
  profileImage?: string;
  coverImage?: string;
  location?: string;
  city?: string;
  priceRange?: string;
  rating?: number;
  totalReviews?: number;
  isVerified?: boolean;
  instagram?: string;
  website?: string;
}

interface PortfolioPost {
  id: string;
  photographerId: string;
  imageUrl: string;
  title?: string;
  description?: string;
  category?: string;
  likesCount: number;
  sharesCount: number;
  reservesCount: number;
}

interface Reservation {
  id: string;
  photographerId: string;
  customerName: string;
  customerEmail: string;
  eventType?: string;
  eventDate: string;
  eventTime?: string;
  location?: string;
  notes?: string;
  status: string;
  createdAt: string;
}

function RoleSelector({ onSelect, colors, t }: { onSelect: (role: UserRole) => void; colors: any; t: any }) {
  return (
    <View style={roleStyles.container}>
      <View style={roleStyles.header}>
        <Ionicons name="camera" size={44} color={colors.accent} />
        <Text style={[roleStyles.title, { color: colors.text }]}>{t('photography.welcomeTitle')}</Text>
        <Text style={[roleStyles.subtitle, { color: colors.textSecondary }]}>{t('photography.welcomeDesc')}</Text>
      </View>

      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSelect('photographer'); }}>
        <LinearGradient colors={[colors.accent, '#0EA5E9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={roleStyles.roleCard}>
          <View style={roleStyles.roleIcon}>
            <Ionicons name="briefcase" size={28} color="#fff" />
          </View>
          <View style={roleStyles.roleInfo}>
            <Text style={roleStyles.roleTitle}>{t('photography.photographerLogin')}</Text>
            <Text style={roleStyles.roleDesc}>{t('photography.photographerDesc')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
        </LinearGradient>
      </Pressable>

      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSelect('customer'); }}>
        <LinearGradient colors={['#8B5CF6', '#6366F1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={roleStyles.roleCard}>
          <View style={roleStyles.roleIcon}>
            <Ionicons name="person" size={28} color="#fff" />
          </View>
          <View style={roleStyles.roleInfo}>
            <Text style={roleStyles.roleTitle}>{t('photography.customerLogin')}</Text>
            <Text style={roleStyles.roleDesc}>{t('photography.customerDesc')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const roleStyles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 40, gap: 24 },
  header: { alignItems: 'center', gap: 10, marginBottom: 20 },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 20, lineHeight: 22 },
  roleCard: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 20, gap: 14 },
  roleIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  roleInfo: { flex: 1 },
  roleTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff', marginBottom: 4 },
  roleDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.8)', lineHeight: 18 },
});

function PhotographerView({ colors, t }: { colors: any; t: any }) {
  const [profile, setProfile] = useState<Photographer | null>(null);
  const [posts, setPosts] = useState<PortfolioPost[]>([]);
  const [reservationsList, setReservationsList] = useState<Reservation[]>([]);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<'portfolio' | 'reservations'>('portfolio');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [instagram, setInstagram] = useState('');

  const [postTitle, setPostTitle] = useState('');
  const [postDescription, setPostDescription] = useState('');
  const [postCategory, setPostCategory] = useState('');
  const [postImage, setPostImage] = useState('');
  const [uploading, setUploading] = useState(false);

  const baseUrl = getApiUrl();

  const createProfile = async () => {
    if (!name.trim() || !email.trim()) {
      Alert.alert(t('photography.required'), t('photography.nameEmailRequired'));
      return;
    }
    setLoading(true);
    try {
      const url = new URL('/api/photography/photographers', baseUrl);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, bio, specialties, priceRange, instagram }),
      });
      if (!response.ok) {
        const err = await response.json();
        Alert.alert(t('photography.error'), err.error || t('photography.createFailed'));
        return;
      }
      const data = await response.json();
      setProfile(data);
      setShowProfileModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert(t('photography.error'), t('photography.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  const pickAndUploadImage = async (): Promise<string | null> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return null;

    setUploading(true);
    try {
      const formData = new FormData();
      const uri = result.assets[0].uri;
      const filename = uri.split('/').pop() || 'image.jpg';
      formData.append('image', { uri, name: filename, type: 'image/jpeg' } as any);

      const url = new URL('/api/photography/upload-image', baseUrl);
      const response = await fetch(url.toString(), { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      return data.imageUrl;
    } catch {
      Alert.alert(t('photography.error'), t('photography.uploadFailed'));
      return null;
    } finally {
      setUploading(false);
    }
  };

  const createPost = async () => {
    if (!postImage || !profile) return;
    setLoading(true);
    try {
      const url = new URL('/api/photography/posts', baseUrl);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photographerId: profile.id,
          imageUrl: postImage,
          title: postTitle,
          description: postDescription,
          category: postCategory,
        }),
      });
      if (!response.ok) throw new Error('Failed');
      const data = await response.json();
      setPosts(prev => [data, ...prev]);
      setShowPostModal(false);
      setPostTitle(''); setPostDescription(''); setPostCategory(''); setPostImage('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert(t('photography.error'), t('photography.postFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadPosts = useCallback(async () => {
    if (!profile) return;
    try {
      const url = new URL(`/api/photography/posts?photographerId=${profile.id}`, baseUrl);
      const response = await fetch(url.toString());
      const data = await response.json();
      setPosts(data);
    } catch {}
  }, [profile, baseUrl]);

  const loadReservations = useCallback(async () => {
    if (!profile) return;
    try {
      const url = new URL(`/api/photography/reservations/${profile.id}`, baseUrl);
      const response = await fetch(url.toString());
      const data = await response.json();
      setReservationsList(data);
    } catch {}
  }, [profile, baseUrl]);

  useEffect(() => {
    if (profile) { loadPosts(); loadReservations(); }
  }, [profile, loadPosts, loadReservations]);

  const updateReservationStatus = async (id: string, status: string) => {
    try {
      const url = new URL(`/api/photography/reservations/${id}/status`, baseUrl);
      await fetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadReservations();
    } catch {}
  };

  if (!profile) {
    return (
      <View style={pStyles.setupContainer}>
        <View style={[pStyles.setupCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="camera" size={48} color={colors.accent} />
          <Text style={[pStyles.setupTitle, { color: colors.text }]}>{t('photography.setupProfile')}</Text>
          <Text style={[pStyles.setupDesc, { color: colors.textSecondary }]}>{t('photography.setupDesc')}</Text>
          <Pressable onPress={() => setShowProfileModal(true)}>
            <LinearGradient colors={[colors.accent, '#0EA5E9']} style={pStyles.setupBtn}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={pStyles.setupBtnText}>{t('photography.createProfile')}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <Modal visible={showProfileModal} animationType="slide" transparent onRequestClose={() => setShowProfileModal(false)}>
          <View style={pStyles.modalOverlay}>
            <View style={[pStyles.modalContent, { backgroundColor: colors.background }]}>
              <View style={pStyles.modalHeader}>
                <Text style={[pStyles.modalTitle, { color: colors.text }]}>{t('photography.createProfile')}</Text>
                <Pressable onPress={() => setShowProfileModal(false)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {[
                  { label: t('photography.nameLabel'), value: name, setter: setName, placeholder: t('photography.namePlaceholder') },
                  { label: t('photography.emailLabel'), value: email, setter: setEmail, placeholder: t('photography.emailPlaceholder') },
                  { label: t('photography.phoneLabel'), value: phone, setter: setPhone, placeholder: '+971 ...' },
                  { label: t('photography.specialtiesLabel'), value: specialties, setter: setSpecialties, placeholder: t('photography.specialtiesPlaceholder') },
                  { label: t('photography.priceLabel'), value: priceRange, setter: setPriceRange, placeholder: 'AED 2,000 - 5,000' },
                  { label: 'Instagram', value: instagram, setter: setInstagram, placeholder: '@yourhandle' },
                ].map((field, i) => (
                  <View key={i}>
                    <Text style={[pStyles.inputLabel, { color: colors.text }]}>{field.label}</Text>
                    <TextInput
                      style={[pStyles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                      placeholder={field.placeholder}
                      placeholderTextColor={colors.textMuted}
                      value={field.value}
                      onChangeText={field.setter}
                    />
                  </View>
                ))}
                <Text style={[pStyles.inputLabel, { color: colors.text }]}>{t('photography.bioLabel')}</Text>
                <TextInput
                  style={[pStyles.inputMulti, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder={t('photography.bioPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={bio}
                  onChangeText={setBio}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <Pressable onPress={createProfile} disabled={loading} style={{ marginTop: 20, marginBottom: 40 }}>
                  <LinearGradient colors={[colors.accent, '#0EA5E9']} style={pStyles.submitBtn}>
                    {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={20} color="#fff" />}
                    <Text style={pStyles.submitBtnText}>{t('photography.saveProfile')}</Text>
                  </LinearGradient>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[pStyles.profileBanner, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={pStyles.profileLeft}>
          <View style={[pStyles.avatar, { backgroundColor: colors.accent + '20' }]}>
            {profile.profileImage ? (
              <Image source={{ uri: baseUrl + profile.profileImage }} style={pStyles.avatarImage} />
            ) : (
              <Ionicons name="camera" size={24} color={colors.accent} />
            )}
          </View>
          <View>
            <Text style={[pStyles.profileName, { color: colors.text }]}>{profile.name}</Text>
            <Text style={[pStyles.profileMeta, { color: colors.textSecondary }]}>
              {profile.specialties || 'Photographer'} {profile.city ? `| ${profile.city}` : ''}
            </Text>
          </View>
        </View>
        <View style={pStyles.profileStats}>
          <View style={pStyles.profileStat}>
            <Text style={[pStyles.profileStatNum, { color: colors.text }]}>{posts.length}</Text>
            <Text style={[pStyles.profileStatLabel, { color: colors.textMuted }]}>{t('photography.posts')}</Text>
          </View>
          <View style={pStyles.profileStat}>
            <Text style={[pStyles.profileStatNum, { color: colors.text }]}>{reservationsList.length}</Text>
            <Text style={[pStyles.profileStatLabel, { color: colors.textMuted }]}>{t('photography.bookings')}</Text>
          </View>
        </View>
      </View>

      <View style={[pStyles.sectionTabs, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Pressable
          onPress={() => setActiveSection('portfolio')}
          style={[pStyles.sectionTab, activeSection === 'portfolio' && { backgroundColor: colors.primary + '15' }]}
        >
          <Ionicons name="images-outline" size={18} color={activeSection === 'portfolio' ? colors.primary : colors.textMuted} />
          <Text style={[pStyles.sectionTabText, { color: activeSection === 'portfolio' ? colors.primary : colors.textMuted }]}>
            {t('photography.portfolio')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveSection('reservations')}
          style={[pStyles.sectionTab, activeSection === 'reservations' && { backgroundColor: colors.primary + '15' }]}
        >
          <Ionicons name="calendar-outline" size={18} color={activeSection === 'reservations' ? colors.primary : colors.textMuted} />
          <Text style={[pStyles.sectionTabText, { color: activeSection === 'reservations' ? colors.primary : colors.textMuted }]}>
            {t('photography.reservations')} ({reservationsList.filter(r => r.status === 'pending').length})
          </Text>
        </Pressable>
      </View>

      {activeSection === 'portfolio' && (
        <>
          <Pressable
            onPress={() => { setShowPostModal(true); setPostImage(''); setPostTitle(''); setPostDescription(''); }}
            style={[pStyles.addPostBtn, { backgroundColor: colors.card, borderColor: colors.accent, borderStyle: 'dashed' as const }]}
          >
            <Ionicons name="add-circle-outline" size={24} color={colors.accent} />
            <Text style={[pStyles.addPostText, { color: colors.accent }]}>{t('photography.addWork')}</Text>
          </Pressable>

          <View style={pStyles.portfolioGrid}>
            {posts.map(post => (
              <View key={post.id} style={[pStyles.portfolioCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Image source={{ uri: baseUrl + post.imageUrl }} style={pStyles.portfolioImage} />
                {post.title && <Text style={[pStyles.portfolioTitle, { color: colors.text }]} numberOfLines={1}>{post.title}</Text>}
                <View style={pStyles.portfolioMeta}>
                  <View style={pStyles.portfolioStat}>
                    <Ionicons name="heart" size={12} color={colors.error} />
                    <Text style={[pStyles.portfolioStatText, { color: colors.textMuted }]}>{post.likesCount}</Text>
                  </View>
                  <View style={pStyles.portfolioStat}>
                    <Ionicons name="bookmark" size={12} color={colors.accent} />
                    <Text style={[pStyles.portfolioStatText, { color: colors.textMuted }]}>{post.reservesCount}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>

          {posts.length === 0 && (
            <View style={pStyles.emptyState}>
              <Ionicons name="images-outline" size={40} color={colors.textMuted} />
              <Text style={[pStyles.emptyText, { color: colors.textSecondary }]}>{t('photography.noPortfolio')}</Text>
            </View>
          )}
        </>
      )}

      {activeSection === 'reservations' && (
        <View style={{ paddingHorizontal: 20 }}>
          {reservationsList.map(res => (
            <View key={res.id} style={[pStyles.reservationCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={pStyles.reservationTop}>
                <View>
                  <Text style={[pStyles.reservationName, { color: colors.text }]}>{res.customerName}</Text>
                  <Text style={[pStyles.reservationMeta, { color: colors.textSecondary }]}>
                    {res.eventType || t('photography.session')} | {res.eventDate} {res.eventTime || ''}
                  </Text>
                  {res.location && (
                    <View style={pStyles.reservationLocRow}>
                      <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                      <Text style={[pStyles.reservationLoc, { color: colors.textMuted }]}>{res.location}</Text>
                    </View>
                  )}
                </View>
                <View style={[pStyles.statusBadge, {
                  backgroundColor: res.status === 'confirmed' ? colors.success + '20'
                    : res.status === 'cancelled' ? colors.error + '20' : colors.accent + '20'
                }]}>
                  <Text style={[pStyles.statusText, {
                    color: res.status === 'confirmed' ? colors.success
                      : res.status === 'cancelled' ? colors.error : colors.accent
                  }]}>{res.status}</Text>
                </View>
              </View>
              {res.status === 'pending' && (
                <View style={pStyles.reservationActions}>
                  <Pressable onPress={() => updateReservationStatus(res.id, 'confirmed')} style={[pStyles.actionBtn, { backgroundColor: colors.success + '15' }]}>
                    <Ionicons name="checkmark" size={16} color={colors.success} />
                    <Text style={[pStyles.actionText, { color: colors.success }]}>{t('photography.confirm')}</Text>
                  </Pressable>
                  <Pressable onPress={() => updateReservationStatus(res.id, 'cancelled')} style={[pStyles.actionBtn, { backgroundColor: colors.error + '15' }]}>
                    <Ionicons name="close" size={16} color={colors.error} />
                    <Text style={[pStyles.actionText, { color: colors.error }]}>{t('photography.decline')}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          {reservationsList.length === 0 && (
            <View style={pStyles.emptyState}>
              <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
              <Text style={[pStyles.emptyText, { color: colors.textSecondary }]}>{t('photography.noReservations')}</Text>
            </View>
          )}
        </View>
      )}

      <Modal visible={showPostModal} animationType="slide" transparent onRequestClose={() => setShowPostModal(false)}>
        <View style={pStyles.modalOverlay}>
          <View style={[pStyles.modalContent, { backgroundColor: colors.background }]}>
            <View style={pStyles.modalHeader}>
              <Text style={[pStyles.modalTitle, { color: colors.text }]}>{t('photography.addWork')}</Text>
              <Pressable onPress={() => setShowPostModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={async () => {
                  const img = await pickAndUploadImage();
                  if (img) setPostImage(img);
                }}
                style={[pStyles.imageUploadArea, { borderColor: colors.accent, backgroundColor: colors.inputBackground }]}
              >
                {uploading ? (
                  <ActivityIndicator size="large" color={colors.accent} />
                ) : postImage ? (
                  <Image source={{ uri: baseUrl + postImage }} style={pStyles.uploadedImage} />
                ) : (
                  <View style={pStyles.uploadPlaceholder}>
                    <Ionicons name="cloud-upload-outline" size={40} color={colors.accent} />
                    <Text style={[pStyles.uploadText, { color: colors.textSecondary }]}>{t('photography.tapToUpload')}</Text>
                  </View>
                )}
              </Pressable>

              <Text style={[pStyles.inputLabel, { color: colors.text }]}>{t('photography.titleLabel')}</Text>
              <TextInput
                style={[pStyles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('photography.titlePlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={postTitle}
                onChangeText={setPostTitle}
              />
              <Text style={[pStyles.inputLabel, { color: colors.text }]}>{t('photography.descLabel')}</Text>
              <TextInput
                style={[pStyles.inputMulti, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('photography.descPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={postDescription}
                onChangeText={setPostDescription}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              <Text style={[pStyles.inputLabel, { color: colors.text }]}>{t('photography.categoryLabel')}</Text>
              <View style={pStyles.categoryRow}>
                {['Wedding', 'Portrait', 'Event', 'Product', 'Fashion', 'Nature'].map(cat => (
                  <Pressable
                    key={cat}
                    onPress={() => setPostCategory(cat)}
                    style={[pStyles.categoryChip, {
                      backgroundColor: postCategory === cat ? colors.primary + '20' : colors.inputBackground,
                      borderColor: postCategory === cat ? colors.primary : colors.inputBorder,
                    }]}
                  >
                    <Text style={[pStyles.categoryText, { color: postCategory === cat ? colors.primary : colors.textSecondary }]}>{cat}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={createPost} disabled={loading || !postImage} style={{ marginTop: 20, marginBottom: 40 }}>
                <LinearGradient
                  colors={!postImage ? [colors.textMuted, colors.textMuted] : [colors.accent, '#0EA5E9']}
                  style={pStyles.submitBtn}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={20} color="#fff" />}
                  <Text style={pStyles.submitBtnText}>{t('photography.publish')}</Text>
                </LinearGradient>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CustomerView({ colors, t }: { colors: any; t: any }) {
  const [photographers, setPhotographers] = useState<Photographer[]>([]);
  const [allPosts, setAllPosts] = useState<PortfolioPost[]>([]);
  const [selectedPhotographer, setSelectedPhotographer] = useState<Photographer | null>(null);
  const [selectedPosts, setSelectedPosts] = useState<PortfolioPost[]>([]);
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [resName, setResName] = useState('');
  const [resEmail, setResEmail] = useState('');
  const [resPhone, setResPhone] = useState('');
  const [resEventType, setResEventType] = useState('');
  const [resDate, setResDate] = useState('');
  const [resTime, setResTime] = useState('');
  const [resLocation, setResLocation] = useState('Dubai');
  const [resNotes, setResNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const baseUrl = getApiUrl();

  const loadPhotographers = useCallback(async () => {
    try {
      const url = new URL('/api/photography/photographers?city=Dubai', baseUrl);
      const response = await fetch(url.toString());
      const data = await response.json();
      setPhotographers(data);
    } catch {} finally { setLoading(false); }
  }, [baseUrl]);

  const loadAllPosts = useCallback(async () => {
    try {
      const url = new URL('/api/photography/posts', baseUrl);
      const response = await fetch(url.toString());
      const data = await response.json();
      setAllPosts(data);
    } catch {}
  }, [baseUrl]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadPhotographers(), loadAllPosts()]);
    setRefreshing(false);
  }, [loadPhotographers, loadAllPosts]);

  useEffect(() => { loadPhotographers(); loadAllPosts(); }, [loadPhotographers, loadAllPosts]);

  const openPhotographerDetail = async (photographer: Photographer) => {
    setSelectedPhotographer(photographer);
    try {
      const url = new URL(`/api/photography/posts?photographerId=${photographer.id}`, baseUrl);
      const response = await fetch(url.toString());
      const data = await response.json();
      setSelectedPosts(data);
    } catch { setSelectedPosts([]); }
    setShowDetailModal(true);
  };

  const handleLike = async (postId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userId = 'customer_' + Date.now().toString(36);
    try {
      const url = new URL(`/api/photography/posts/${postId}/interact`, baseUrl);
      await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'like', userId }),
      });
      setLikedPosts(prev => {
        const next = new Set(prev);
        if (next.has(postId)) next.delete(postId); else next.add(postId);
        return next;
      });
    } catch {}
  };

  const handleReserve = async () => {
    if (!resName.trim() || !resEmail.trim() || !resDate.trim() || !selectedPhotographer) return;
    setSubmitting(true);
    try {
      const url = new URL('/api/photography/reservations', baseUrl);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photographerId: selectedPhotographer.id,
          customerName: resName,
          customerEmail: resEmail,
          customerPhone: resPhone,
          eventType: resEventType,
          eventDate: resDate,
          eventTime: resTime,
          location: resLocation,
          notes: resNotes,
        }),
      });
      if (!response.ok) throw new Error('Failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('photography.reservationSent'), t('photography.reservationSentDesc'));
      setShowReserveModal(false);
      setResName(''); setResEmail(''); setResPhone(''); setResEventType(''); setResDate(''); setResTime(''); setResNotes('');
    } catch {
      Alert.alert(t('photography.error'), t('photography.reservationFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={cStyles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[cStyles.loadingText, { color: colors.textSecondary }]}>{t('photography.loadingPhotographers')}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={cStyles.locationBar}>
        <Ionicons name="location" size={16} color={colors.accent} />
        <Text style={[cStyles.locationText, { color: colors.text }]}>Dubai, UAE</Text>
        <View style={[cStyles.locationBadge, { backgroundColor: colors.accent + '15' }]}>
          <Text style={[cStyles.locationBadgeText, { color: colors.accent }]}>{photographers.length} {t('photography.found')}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {photographers.length > 0 && (
          <View style={cStyles.section}>
            <Text style={[cStyles.sectionTitle, { color: colors.text }]}>{t('photography.topPhotographers')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cStyles.horizontalScroll}>
              {photographers.map(p => (
                <Pressable key={p.id} onPress={() => openPhotographerDetail(p)}
                  style={[cStyles.photographerCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={[cStyles.photographerAvatar, { backgroundColor: colors.accent + '20' }]}>
                    {p.profileImage ? (
                      <Image source={{ uri: baseUrl + p.profileImage }} style={cStyles.photographerAvatarImage} />
                    ) : (
                      <Ionicons name="camera" size={24} color={colors.accent} />
                    )}
                  </View>
                  <Text style={[cStyles.photographerName, { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
                  <Text style={[cStyles.photographerSpecialty, { color: colors.textSecondary }]} numberOfLines={1}>
                    {p.specialties || 'Photographer'}
                  </Text>
                  {p.priceRange && (
                    <Text style={[cStyles.photographerPrice, { color: colors.accent }]}>{p.priceRange}</Text>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={cStyles.section}>
          <Text style={[cStyles.sectionTitle, { color: colors.text }]}>{t('photography.latestWork')}</Text>
          <View style={cStyles.feedGrid}>
            {allPosts.map(post => {
              const photographer = photographers.find(p => p.id === post.photographerId);
              return (
                <View key={post.id} style={[cStyles.feedCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Pressable onPress={() => photographer && openPhotographerDetail(photographer)}>
                    <Image source={{ uri: baseUrl + post.imageUrl }} style={cStyles.feedImage} />
                  </Pressable>
                  {post.title && <Text style={[cStyles.feedTitle, { color: colors.text }]} numberOfLines={1}>{post.title}</Text>}
                  {photographer && (
                    <View style={cStyles.feedAuthor}>
                      <Ionicons name="person-circle-outline" size={14} color={colors.textMuted} />
                      <Text style={[cStyles.feedAuthorName, { color: colors.textSecondary }]} numberOfLines={1}>{photographer.name}</Text>
                    </View>
                  )}
                  <View style={cStyles.feedActions}>
                    <Pressable onPress={() => handleLike(post.id)} style={cStyles.feedAction}>
                      <Ionicons name={likedPosts.has(post.id) ? "heart" : "heart-outline"} size={18} color={likedPosts.has(post.id) ? colors.error : colors.textMuted} />
                      <Text style={[cStyles.feedActionText, { color: colors.textMuted }]}>{post.likesCount + (likedPosts.has(post.id) ? 1 : 0)}</Text>
                    </Pressable>
                    <Pressable style={cStyles.feedAction}>
                      <Ionicons name="share-outline" size={18} color={colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (photographer) {
                          setSelectedPhotographer(photographer);
                          setShowReserveModal(true);
                        }
                      }}
                      style={[cStyles.feedReserveBtn, { backgroundColor: colors.accent + '15' }]}
                    >
                      <Ionicons name="calendar-outline" size={14} color={colors.accent} />
                      <Text style={[cStyles.feedReserveText, { color: colors.accent }]}>{t('photography.reserve')}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
          {allPosts.length === 0 && (
            <View style={cStyles.emptyFeed}>
              <Ionicons name="images-outline" size={40} color={colors.textMuted} />
              <Text style={[cStyles.emptyFeedText, { color: colors.textSecondary }]}>{t('photography.noPosts')}</Text>
            </View>
          )}
        </View>
        <View style={{ height: 120 }} />
      </ScrollView>

      <Modal visible={showDetailModal} animationType="slide" transparent onRequestClose={() => setShowDetailModal(false)}>
        <View style={cStyles.modalOverlay}>
          <View style={[cStyles.modalContent, { backgroundColor: colors.background }]}>
            <View style={cStyles.modalHeader}>
              <Pressable onPress={() => setShowDetailModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
              <Text style={[cStyles.modalTitle, { color: colors.text }]}>{selectedPhotographer?.name}</Text>
              <Pressable onPress={() => { setShowReserveModal(true); }}>
                <Ionicons name="calendar" size={24} color={colors.accent} />
              </Pressable>
            </View>

            {selectedPhotographer && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={[cStyles.detailHeader, { backgroundColor: colors.card }]}>
                  <View style={[cStyles.detailAvatar, { backgroundColor: colors.accent + '20' }]}>
                    {selectedPhotographer.profileImage ? (
                      <Image source={{ uri: baseUrl + selectedPhotographer.profileImage }} style={cStyles.detailAvatarImage} />
                    ) : (
                      <Ionicons name="camera" size={32} color={colors.accent} />
                    )}
                  </View>
                  <Text style={[cStyles.detailName, { color: colors.text }]}>{selectedPhotographer.name}</Text>
                  <Text style={[cStyles.detailSpecialty, { color: colors.textSecondary }]}>
                    {selectedPhotographer.specialties || 'Photographer'}
                  </Text>
                  <View style={cStyles.detailMeta}>
                    <View style={cStyles.detailMetaItem}>
                      <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                      <Text style={[cStyles.detailMetaText, { color: colors.textMuted }]}>{selectedPhotographer.city || 'Dubai'}</Text>
                    </View>
                    {selectedPhotographer.priceRange && (
                      <View style={cStyles.detailMetaItem}>
                        <Ionicons name="cash-outline" size={14} color={colors.accent} />
                        <Text style={[cStyles.detailMetaText, { color: colors.accent }]}>{selectedPhotographer.priceRange}</Text>
                      </View>
                    )}
                  </View>
                  {selectedPhotographer.bio && (
                    <Text style={[cStyles.detailBio, { color: colors.textSecondary }]}>{selectedPhotographer.bio}</Text>
                  )}
                </View>

                <Pressable
                  onPress={() => setShowReserveModal(true)}
                  style={{ marginHorizontal: 20, marginTop: 16 }}
                >
                  <LinearGradient colors={[colors.accent, '#0EA5E9']} style={cStyles.reserveBtn}>
                    <Ionicons name="calendar" size={20} color="#fff" />
                    <Text style={cStyles.reserveBtnText}>{t('photography.reserveNow')}</Text>
                  </LinearGradient>
                </Pressable>

                <Text style={[cStyles.detailSectionTitle, { color: colors.text }]}>{t('photography.portfolio')}</Text>
                <View style={cStyles.detailGrid}>
                  {selectedPosts.map(post => (
                    <View key={post.id} style={cStyles.detailImageWrap}>
                      <Image source={{ uri: baseUrl + post.imageUrl }} style={cStyles.detailImage} />
                    </View>
                  ))}
                </View>
                {selectedPosts.length === 0 && (
                  <View style={cStyles.emptyFeed}>
                    <Text style={[cStyles.emptyFeedText, { color: colors.textSecondary }]}>{t('photography.noPortfolio')}</Text>
                  </View>
                )}
                <View style={{ height: 40 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showReserveModal} animationType="slide" transparent onRequestClose={() => setShowReserveModal(false)}>
        <View style={cStyles.modalOverlay}>
          <View style={[cStyles.modalContent, { backgroundColor: colors.background }]}>
            <View style={cStyles.modalHeader}>
              <Pressable onPress={() => setShowReserveModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
              <Text style={[cStyles.modalTitle, { color: colors.text }]}>{t('photography.reserveTitle')}</Text>
              <View style={{ width: 24 }} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {selectedPhotographer && (
                <View style={[cStyles.reservePhotographerInfo, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Ionicons name="camera" size={20} color={colors.accent} />
                  <Text style={[cStyles.reservePhotographerName, { color: colors.text }]}>{selectedPhotographer.name}</Text>
                </View>
              )}
              {[
                { label: t('photography.yourName'), value: resName, setter: setResName, placeholder: t('photography.namePlaceholder') },
                { label: t('photography.yourEmail'), value: resEmail, setter: setResEmail, placeholder: t('photography.emailPlaceholder') },
                { label: t('photography.yourPhone'), value: resPhone, setter: setResPhone, placeholder: '+971 ...' },
                { label: t('photography.eventDate'), value: resDate, setter: setResDate, placeholder: '2026-03-15' },
                { label: t('photography.eventTime'), value: resTime, setter: setResTime, placeholder: '14:00' },
                { label: t('photography.eventLocation'), value: resLocation, setter: setResLocation, placeholder: 'Dubai Marina' },
              ].map((field, i) => (
                <View key={i}>
                  <Text style={[pStyles.inputLabel, { color: colors.text }]}>{field.label}</Text>
                  <TextInput
                    style={[pStyles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.textMuted}
                    value={field.value}
                    onChangeText={field.setter}
                  />
                </View>
              ))}
              <Text style={[pStyles.inputLabel, { color: colors.text }]}>{t('photography.eventType')}</Text>
              <View style={pStyles.categoryRow}>
                {['Wedding', 'Portrait', 'Event', 'Product', 'Corporate', 'Other'].map(type => (
                  <Pressable key={type} onPress={() => setResEventType(type)}
                    style={[pStyles.categoryChip, {
                      backgroundColor: resEventType === type ? colors.accent + '20' : colors.inputBackground,
                      borderColor: resEventType === type ? colors.accent : colors.inputBorder,
                    }]}
                  >
                    <Text style={[pStyles.categoryText, { color: resEventType === type ? colors.accent : colors.textSecondary }]}>{type}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[pStyles.inputLabel, { color: colors.text }]}>{t('photography.notes')}</Text>
              <TextInput
                style={[pStyles.inputMulti, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('photography.notesPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={resNotes}
                onChangeText={setResNotes}
                multiline numberOfLines={3} textAlignVertical="top"
              />
              <Pressable onPress={handleReserve} disabled={submitting || !resName.trim() || !resEmail.trim() || !resDate.trim()} style={{ marginTop: 20, marginBottom: 40 }}>
                <LinearGradient
                  colors={(!resName.trim() || !resEmail.trim() || !resDate.trim()) ? [colors.textMuted, colors.textMuted] : [colors.accent, '#0EA5E9']}
                  style={pStyles.submitBtn}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={20} color="#fff" />}
                  <Text style={pStyles.submitBtnText}>{t('photography.sendReservation')}</Text>
                </LinearGradient>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function PhotographyScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [role, setRole] = useState<UserRole>('none');

  return (
    <View style={[mainStyles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          mainStyles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
      >
        {role !== 'none' && (
          <View style={mainStyles.header}>
            <Pressable onPress={() => setRole('none')}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
            <Text style={[mainStyles.title, { color: colors.text }]}>
              {role === 'photographer' ? t('photography.photographerTitle') : t('photography.customerTitle')}
            </Text>
            <View style={{ width: 24 }} />
          </View>
        )}

        {role === 'none' && <RoleSelector onSelect={setRole} colors={colors} t={t} />}
        {role === 'photographer' && <PhotographerView colors={colors} t={t} />}
        {role === 'customer' && <CustomerView colors={colors} t={t} />}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const mainStyles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
});

const pStyles = StyleSheet.create({
  setupContainer: { paddingHorizontal: 20, paddingTop: 40 },
  setupCard: { alignItems: 'center', padding: 40, borderRadius: 24, borderWidth: 1, gap: 14 },
  setupTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  setupDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  setupBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, gap: 8 },
  setupBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 40, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  inputLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', marginBottom: 8, marginTop: 14 },
  input: { borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 15, fontFamily: 'Inter_400Regular' },
  inputMulti: { borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 15, fontFamily: 'Inter_400Regular', minHeight: 90, textAlignVertical: 'top' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 10 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  profileBanner: { marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  profileLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: 48, height: 48, borderRadius: 24 },
  profileName: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  profileMeta: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  profileStats: { flexDirection: 'row', gap: 16 },
  profileStat: { alignItems: 'center' },
  profileStatNum: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  profileStatLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  sectionTabs: { flexDirection: 'row', marginHorizontal: 20, borderRadius: 16, borderWidth: 1, padding: 4, marginBottom: 16 },
  sectionTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, gap: 6 },
  sectionTabText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  addPostBtn: { marginHorizontal: 20, padding: 20, borderRadius: 16, borderWidth: 2, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  addPostText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10 },
  portfolioCard: { width: CARD_WIDTH, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  portfolioImage: { width: '100%', height: CARD_WIDTH, backgroundColor: '#ddd' },
  portfolioTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', paddingHorizontal: 10, paddingTop: 8 },
  portfolioMeta: { flexDirection: 'row', padding: 10, gap: 12 },
  portfolioStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  portfolioStatText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  imageUploadArea: { height: 200, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed' as const, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 10 },
  uploadedImage: { width: '100%', height: '100%' },
  uploadPlaceholder: { alignItems: 'center', gap: 10 },
  uploadText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  categoryText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  reservationCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 10 },
  reservationTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  reservationName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  reservationMeta: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  reservationLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  reservationLoc: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' as const },
  reservationActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10, gap: 6 },
  actionText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});

const cStyles = StyleSheet.create({
  loadingContainer: { alignItems: 'center', paddingVertical: 80, gap: 16 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  locationBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 6 },
  locationText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  locationBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginLeft: 'auto' as const },
  locationBadgeText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 20, marginBottom: 14 },
  horizontalScroll: { paddingHorizontal: 16, gap: 12 },
  photographerCard: { width: 140, borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center', gap: 8 },
  photographerAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photographerAvatarImage: { width: 64, height: 64, borderRadius: 32 },
  photographerName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  photographerSpecialty: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  photographerPrice: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  feedGrid: { paddingHorizontal: 16, gap: 12 },
  feedCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  feedImage: { width: '100%', height: 220, backgroundColor: '#ddd' },
  feedTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 14, paddingTop: 12 },
  feedAuthor: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 6 },
  feedAuthorName: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  feedActions: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 16 },
  feedAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  feedActionText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  feedReserveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, marginLeft: 'auto' as const },
  feedReserveText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  emptyFeed: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyFeedText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingHorizontal: 0, paddingBottom: 0, maxHeight: '92%', flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  detailHeader: { alignItems: 'center', paddingVertical: 24, marginHorizontal: 20, borderRadius: 20, gap: 8, marginBottom: 8 },
  detailAvatar: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  detailAvatarImage: { width: 80, height: 80, borderRadius: 40 },
  detailName: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  detailSpecialty: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  detailMeta: { flexDirection: 'row', gap: 16, marginTop: 4 },
  detailMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailMetaText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  detailBio: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 20, lineHeight: 20, marginTop: 8 },
  reserveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 10 },
  reserveBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  detailSectionTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 20, marginTop: 24, marginBottom: 14 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 4 },
  detailImageWrap: { width: (SCREEN_WIDTH - 40) / 3, height: (SCREEN_WIDTH - 40) / 3 },
  detailImage: { width: '100%', height: '100%', borderRadius: 4 },
  reservePhotographerInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10 },
  reservePhotographerName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
