import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { authFetch, getApiUrl, safeApiJson } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import AvyronLogo from '@/components/AvyronLogo';

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { selectedCampaign, refreshCampaigns, refreshSelection } = useCampaign();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [websiteUrl, setWebsiteUrl] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('');
  const [industry, setIndustry] = useState<string>('');
  const [businessModel, setBusinessModel] = useState<string>('');
  const [detectedAudience, setDetectedAudience] = useState<string>('');
  const [productCatalogue, setProductCatalogue] = useState<Array<{ id: string; name: string; description: string }>>([]);

  const [targetMarket, setTargetMarket] = useState<string>('United Arab Emirates');
  const marketOptions = ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Egypt', 'Lebanon', 'United Kingdom', 'United States'];

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [customProductName, setCustomProductName] = useState<string>('');
  const [customProductNotes, setCustomProductNotes] = useState<string>('');
  const [isAddingCustomProduct, setIsAddingCustomProduct] = useState<boolean>(false);

  const [ownedChannels, setOwnedChannels] = useState<{
    instagram: string;
    tiktok: string;
    youtube: string;
    linkedin: string;
    x: string;
  }>({
    instagram: '',
    tiktok: '',
    youtube: '',
    linkedin: '',
    x: '',
  });

  const [candidateCompetitors, setCandidateCompetitors] = useState<Array<{
    name: string;
    websiteUrl: string;
    classification: string;
    reason: string;
    selected: boolean;
  }>>([]);
  const [manualCompName, setManualCompName] = useState<string>('');
  const [manualCompUrl, setManualCompUrl] = useState<string>('');
  const [isAddingManualComp, setIsAddingManualComp] = useState<boolean>(false);

  const [campaignId, setCampaignId] = useState<string>((params.campaignId as string) || selectedCampaign?.selectedCampaignId || '');
  const [discoveryStatus, setDiscoveryStatus] = useState<string>('DISCOVERY_COMPLETE');
  const [discoveryMessage, setDiscoveryMessage] = useState<string>('');

  useEffect(() => {
    if (selectedCampaign?.selectedCampaignId && !campaignId) {
      setCampaignId(selectedCampaign.selectedCampaignId);
    }
  }, [selectedCampaign?.selectedCampaignId, campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      try {
        const res = await authFetch(getApiUrl('/api/setup/state/' + campaignId));
        const json = await safeApiJson(res);
        if (json.success) {
          if (json.websiteUrl) setWebsiteUrl(json.websiteUrl);
          if (json.companyName) setCompanyName(json.companyName);
          if (json.industry) setIndustry(json.industry);
          if (json.businessModel) setBusinessModel(json.businessModel);
          if (json.targetMarket) setTargetMarket(json.targetMarket);
          if (Array.isArray(json.productCatalogue) && json.productCatalogue.length > 0) {
            setProductCatalogue(json.productCatalogue);
          }
          if (json.selectedOffering) {
            setCustomProductName(json.selectedOffering.name);
          }
          if (Array.isArray(json.channels)) {
            const chMap: any = { instagram: '', tiktok: '', youtube: '', linkedin: '', x: '' };
            json.channels.forEach((c: any) => {
              if (chMap[c.platform] !== undefined) chMap[c.platform] = c.handle;
            });
            setOwnedChannels(chMap);
          }

          if (json.step === '02_MARKET') setCurrentStep(2);
          else if (json.step === '03_FOCUS') setCurrentStep(3);
          else if (json.step === '04_CHANNELS') setCurrentStep(4);
          else if (json.step === '05_COMPETITORS') setCurrentStep(5);
          else if (json.step === '06_READY') setCurrentStep(6);
        }
      } catch (err) {
        console.warn('[SetupScreen] Resume check failed:', err);
      }
    })();
  }, [campaignId]);

  const handleAnalyzeBusiness = async () => {
    if (!websiteUrl.trim()) {
      setErrorMessage('Please enter your business website URL.');
      return;
    }
    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Crawling website pages & extracting business intelligence...');

    try {
      const res = await authFetch(getApiUrl('/api/setup/analyze-website'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl: websiteUrl.trim(),
          campaignId: campaignId,
        }),
      });
      const json = await safeApiJson(res);
      if (json.success && json.data) {
        if (json.campaignId) {
          setCampaignId(json.campaignId);
        }
        setCompanyName(json.data.companyName);
        setIndustry(json.data.industry);
        setBusinessModel(json.data.businessModel);
        setDetectedAudience(json.data.detectedAudience);
        const catalogue = Array.isArray(json.data.productCatalogue) ? json.data.productCatalogue : [];
        setProductCatalogue(catalogue);
        if (catalogue.length > 0) {
          setSelectedProductId(catalogue[0].id);
          setIsAddingCustomProduct(false);
        } else {
          setSelectedProductId('');
          setIsAddingCustomProduct(true);
        }
        setStatusMessage('');
        setCurrentStep(2);
      } else {
        throw new Error(json.error || 'Website analysis failed');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not analyze website. Please check the URL and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveMarket = async () => {
    if (!targetMarket.trim()) {
      setErrorMessage('Please select a target market.');
      return;
    }
    if (!campaignId) {
      setErrorMessage('Campaign session not found. Please restart website analysis in Step 1.');
      return;
    }
    setErrorMessage('');
    setIsLoading(true);
    try {
      await authFetch(getApiUrl('/api/setup/save-market'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          targetMarket: targetMarket.trim(),
        }),
      });
      setCurrentStep(3);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save market.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveHeroProduct = async () => {
    let offeringName = customProductName.trim();
    let offeringNotes = customProductNotes.trim();
    let source: 'DISCOVERED' | 'USER_CONFIRMED' = 'USER_CONFIRMED';

    if (!isAddingCustomProduct && selectedProductId && productCatalogue.length > 0) {
      const found = productCatalogue.find((p) => p.id === selectedProductId);
      if (found) {
        offeringName = found.name.trim();
        offeringNotes = found.description?.trim() || '';
        source = 'DISCOVERED';
      }
    }

    if (isAddingCustomProduct || !offeringName) {
      offeringName = customProductName.trim();
      offeringNotes = customProductNotes.trim();
      source = 'USER_CONFIRMED';
    }

    if (!offeringName) {
      setErrorMessage('Please enter or select a hero product / service.');
      return;
    }

    if (!campaignId) {
      setErrorMessage('Campaign session not found. Please restart website analysis in Step 1.');
      return;
    }

    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Synthesizing Product Truth & Target Roles from canonical evidence...');

    try {
      const res = await authFetch(getApiUrl('/api/setup/save-offering'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          offeringName,
          offeringFeaturesAndNotes: offeringNotes,
          source,
          targetMarket,
        }),
      });
      const json = await safeApiJson(res);
      if (json.success) {
        setStatusMessage('');
        setCurrentStep(4);
      } else {
        throw new Error(json.error || 'Failed to save offering');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Business Understanding failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveChannels = async () => {
    if (!campaignId) {
      setErrorMessage('Campaign session not found.');
      return;
    }
    setErrorMessage('');
    setIsLoading(true);

    const channelsToSave: Array<{ platform: string; handle: string }> = [];
    if (ownedChannels.instagram.trim()) channelsToSave.push({ platform: 'instagram', handle: ownedChannels.instagram.trim() });
    if (ownedChannels.tiktok.trim()) channelsToSave.push({ platform: 'tiktok', handle: ownedChannels.tiktok.trim() });
    if (ownedChannels.youtube.trim()) channelsToSave.push({ platform: 'youtube', handle: ownedChannels.youtube.trim() });
    if (ownedChannels.linkedin.trim()) channelsToSave.push({ platform: 'linkedin', handle: ownedChannels.linkedin.trim() });
    if (ownedChannels.x.trim()) channelsToSave.push({ platform: 'x', handle: ownedChannels.x.trim() });

    try {
      if (channelsToSave.length > 0) {
        const chanRes = await authFetch(getApiUrl('/api/setup/save-channels'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            channels: channelsToSave,
          }),
        });
        const chanJson = await safeApiJson(chanRes);
        if (!chanJson.success) {
          throw new Error(chanJson.error || 'Failed to save channels');
        }
      }

      setStatusMessage('Discovering real-world competitors from verified Business Understanding...');
      const compRes = await authFetch(getApiUrl('/api/setup/discover-competitors'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      const compJson = await safeApiJson(compRes);
      if (compJson.status) {
        setDiscoveryStatus(compJson.status);
        setDiscoveryMessage(compJson.message || '');
      }
      if (Array.isArray(compJson.candidates)) {
        setCandidateCompetitors(compJson.candidates.map((c: any) => ({ ...c, selected: true })));
      }
      setStatusMessage('');
      setCurrentStep(5);
    } catch (err: any) {
      setErrorMessage(err.message || 'Channel update failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetryDiscovery = async () => {
    if (!campaignId) return;
    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Retrying real competitor discovery...');
    try {
      const compRes = await authFetch(getApiUrl('/api/setup/discover-competitors'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      const compJson = await safeApiJson(compRes);
      if (compJson.status) {
        setDiscoveryStatus(compJson.status);
        setDiscoveryMessage(compJson.message || '');
      }
      if (Array.isArray(compJson.candidates)) {
        setCandidateCompetitors(compJson.candidates.map((c: any) => ({ ...c, selected: true })));
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Competitor discovery retry failed.');
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleApproveCompetitors = async () => {
    if (!campaignId) {
      setErrorMessage('Campaign session not found.');
      return;
    }
    const approved = candidateCompetitors.filter((c) => c.selected);
    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Registering competitors and initializing Watchtower monitoring...');

    try {
      if (approved.length > 0) {
        await authFetch(getApiUrl('/api/setup/approve-competitors'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            approvedCompetitors: approved,
          }),
        });
      }
      setStatusMessage('');
      setCurrentStep(6);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to approve competitors.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddManualCompetitor = () => {
    if (!manualCompName.trim()) return;
    const url = manualCompUrl.trim() || ('https://' + manualCompName.toLowerCase().replace(/\\s+/g, '') + '.com');
    setCandidateCompetitors((prev) => [
      ...prev,
      {
        name: manualCompName.trim(),
        websiteUrl: url,
        classification: 'DIRECT_COMPETITOR',
        reason: 'User-specified competitor entity.',
        selected: true,
      },
    ]);
    setManualCompName('');
    setManualCompUrl('');
    setIsAddingManualComp(false);
  };

  const handleBuildStrategy = async () => {
    if (!campaignId) {
      setErrorMessage('Campaign session not found.');
      return;
    }
    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Validating canonical campaign prerequisites...');

    try {
      const res = await authFetch(getApiUrl('/api/setup/build-strategy-gate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      const json = await safeApiJson(res);
      if (json.success && json.ready) {
        await refreshCampaigns();
        await refreshSelection();
        router.replace('/(tabs)');
      } else {
        throw new Error(json.error || 'Campaign prerequisites not met');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Strategy build gate failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0A0D14', '#0F172A', '#0A0D14']}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 24 : insets.top + 12 }]}>
        <View style={styles.logoRow}>
          <AvyronLogo size={28} />
          <Text style={styles.logoTitle}>AVYRON</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>SETUP</Text>
          </View>
        </View>
        <Text style={styles.stepIndicator}>STEP {currentStep} OF 6</Text>
      </View>

      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: String((currentStep / 6) * 100) + '%' }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {errorMessage ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={16} color="#EF4444" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {isLoading && (
          <View style={styles.statusBox}>
            <ActivityIndicator size="small" color="#8B5CF6" />
            <Text style={styles.statusText}>{statusMessage || 'Processing...'}</Text>
          </View>
        )}

        {currentStep === 1 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>01</Text>
              </View>
              <View>
                <Text style={styles.cardTitle}>Set Up Your Business</Text>
                <Text style={styles.cardSubtitle}>Enter your website to extract your company profile & products.</Text>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Business Website</Text>
              <View style={styles.inputWrapper}>
                <Feather name="globe" size={16} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="https://yourcompany.com"
                  placeholderTextColor="#475569"
                  value={websiteUrl}
                  onChangeText={setWebsiteUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>
            </View>

            {companyName ? (
              <View style={styles.previewBox}>
                <Text style={styles.previewTitle}>Detected Intelligence:</Text>
                <Text style={styles.previewItem}>• <Text style={styles.bold}>Company:</Text> {companyName}</Text>
                <Text style={styles.previewItem}>• <Text style={styles.bold}>Industry:</Text> {industry}</Text>
                <Text style={styles.previewItem}>• <Text style={styles.bold}>Model:</Text> {businessModel}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
              onPress={handleAnalyzeBusiness}
              disabled={isLoading}
            >
              <Text style={styles.primaryBtnText}>Analyze My Business</Text>
              <Feather name="arrow-right" size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        )}

        {currentStep === 2 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>02</Text>
              </View>
              <View>
                <Text style={styles.cardTitle}>Target Market</Text>
                <Text style={styles.cardSubtitle}>Which geographic market will this campaign compete in?</Text>
              </View>
            </View>

            <View style={styles.chipGrid}>
              {marketOptions.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.chip, targetMarket === m && styles.chipActive]}
                  onPress={() => setTargetMarket(m)}
                >
                  <Text style={[styles.chipText, targetMarket === m && styles.chipTextActive]}>{m}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Or specify custom country / region</Text>
              <TextInput
                style={styles.inputStandalone}
                placeholder="e.g. Saudi Arabia, GCC, North America"
                placeholderTextColor="#475569"
                value={targetMarket}
                onChangeText={setTargetMarket}
              />
            </View>

            <View style={styles.btnRow}>
              <Pressable style={styles.secondaryBtn} onPress={() => setCurrentStep(1)}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={handleSaveMarket}>
                <Text style={styles.primaryBtnText}>Continue</Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}

        {currentStep === 3 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>03</Text>
              </View>
              <View>
                <Text style={styles.cardTitle}>Campaign Focus</Text>
                <Text style={styles.cardSubtitle}>Choose the product or service you want this campaign to focus on.</Text>
              </View>
            </View>

            {!isAddingCustomProduct && productCatalogue.length > 0 ? (
              <View style={styles.productList}>
                <Text style={styles.sectionHeading}>Suggested from your website</Text>
                {productCatalogue.map((p) => (
                  <Pressable
                    key={p.id}
                    style={[styles.productCard, selectedProductId === p.id && styles.productCardActive]}
                    onPress={() => setSelectedProductId(p.id)}
                  >
                    <View style={styles.productHeader}>
                      <Text style={styles.productName}>{p.name}</Text>
                      {selectedProductId === p.id && (
                        <Ionicons name="checkmark-circle" size={18} color="#8B5CF6" />
                      )}
                    </View>
                    <Text style={styles.productDesc}>{p.description}</Text>
                  </Pressable>
                ))}

                <Pressable style={styles.addOutlineBtn} onPress={() => setIsAddingCustomProduct(true)}>
                  <Feather name="plus" size={14} color="#8B5CF6" />
                  <Text style={styles.addOutlineBtnText}>Add another product or service</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.customProductBox}>
                <View style={styles.formIntroBox}>
                  <Text style={styles.formIntroTitle}>What do you want this campaign to focus on?</Text>
                  <Text style={styles.formIntroHelper}>Enter the product or service Avyron should build this campaign around.</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Product / Offering Name</Text>
                  <TextInput
                    style={styles.inputStandalone}
                    placeholder="e.g. summer hijabi dresses"
                    placeholderTextColor="#475569"
                    value={customProductName}
                    onChangeText={setCustomProductName}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Features, Pricing & Notes</Text>
                  <TextInput
                    style={[styles.inputStandalone, { height: 80 }]}
                    placeholder="e.g. 35$–62$, key capabilities, pricing tiers, and main use cases..."
                    placeholderTextColor="#475569"
                    value={customProductNotes}
                    onChangeText={setCustomProductNotes}
                    multiline
                  />
                </View>
                {productCatalogue.length > 0 && (
                  <Pressable onPress={() => setIsAddingCustomProduct(false)}>
                    <Text style={styles.cancelLink}>← Back to website suggestions</Text>
                  </Pressable>
                )}
              </View>
            )}

            <View style={styles.btnRow}>
              <Pressable style={styles.secondaryBtn} onPress={() => setCurrentStep(2)}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={handleSaveHeroProduct}>
                <Text style={styles.primaryBtnText}>Confirm Focus</Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}

        {currentStep === 4 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>04</Text>
              </View>
              <View>
                <Text style={styles.cardTitle}>Your Channels</Text>
                <Text style={styles.cardSubtitle}>Connect the channels you currently operate. You only need one to start.</Text>
              </View>
            </View>

            <View style={styles.channelRow}>
              <Text style={styles.channelLabel}>Instagram</Text>
              <TextInput
                style={styles.channelInput}
                placeholder="@yourhandle"
                placeholderTextColor="#475569"
                value={ownedChannels.instagram}
                onChangeText={(v) => setOwnedChannels((p) => ({ ...p, instagram: v }))}
              />
            </View>

            <View style={styles.channelRow}>
              <Text style={styles.channelLabel}>TikTok</Text>
              <TextInput
                style={styles.channelInput}
                placeholder="@yourhandle"
                placeholderTextColor="#475569"
                value={ownedChannels.tiktok}
                onChangeText={(v) => setOwnedChannels((p) => ({ ...p, tiktok: v }))}
              />
            </View>

            <View style={styles.channelRow}>
              <Text style={styles.channelLabel}>YouTube</Text>
              <TextInput
                style={styles.channelInput}
                placeholder="@channel"
                placeholderTextColor="#475569"
                value={ownedChannels.youtube}
                onChangeText={(v) => setOwnedChannels((p) => ({ ...p, youtube: v }))}
              />
            </View>

            <View style={styles.channelRow}>
              <Text style={styles.channelLabel}>LinkedIn</Text>
              <TextInput
                style={styles.channelInput}
                placeholder="company/handle"
                placeholderTextColor="#475569"
                value={ownedChannels.linkedin}
                onChangeText={(v) => setOwnedChannels((p) => ({ ...p, linkedin: v }))}
              />
            </View>

            <View style={styles.btnRow}>
              <Pressable style={styles.secondaryBtn} onPress={() => setCurrentStep(3)}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={handleSaveChannels}>
                <Text style={styles.primaryBtnText}>Discover Competitors</Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}

        {currentStep === 5 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>05</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>
                  {candidateCompetitors.length > 0 ? "We Found Competitors" : "Competitor Discovery"}
                </Text>
                <Text style={styles.cardSubtitle}>
                  {candidateCompetitors.length > 0 
                    ? "Verified competitors discovered from real search fighting for the same customer budget."
                    : "Real-time competitor search status and manual setup."}
                </Text>
              </View>
            </View>

            {discoveryStatus === 'SEARCH_PROVIDER_UNAVAILABLE' && (
              <View style={styles.providerErrorBox}>
                <Feather name="alert-triangle" size={18} color="#F59E0B" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.providerErrorTitle}>Search Provider Unavailable</Text>
                  <Text style={styles.providerErrorText}>
                    We could not complete real-time competitor discovery right now. You can retry discovery or add your competitors manually below.
                  </Text>
                </View>
                <Pressable style={styles.retryBtnSmall} onPress={handleRetryDiscovery}>
                  <Feather name="refresh-cw" size={14} color="#FFFFFF" />
                  <Text style={styles.retryBtnSmallText}>Retry</Text>
                </Pressable>
              </View>
            )}

            {discoveryStatus === 'NO_VERIFIED_COMPETITORS' && candidateCompetitors.length === 0 && (
              <View style={styles.noCompBox}>
                <Feather name="info" size={18} color="#94A3B8" />
                <Text style={styles.noCompText}>
                  Real search executed, but no direct commercial competitors met the automatic approval criteria. Add your direct competitors manually to proceed.
                </Text>
              </View>
            )}

            <View style={styles.compList}>
              {candidateCompetitors.map((c, i) => (
                <Pressable
                  key={c.name + i}
                  style={[styles.compCard, c.selected && styles.compCardActive]}
                  onPress={() => {
                    setCandidateCompetitors((prev) =>
                      prev.map((item, idx) => (idx === i ? { ...item, selected: !item.selected } : item))
                    );
                  }}
                >
                  <View style={styles.compTop}>
                    <View style={styles.compInfo}>
                      <Text style={styles.compName}>{c.name}</Text>
                      <Text style={styles.compUrl}>{c.websiteUrl}</Text>
                    </View>
                    <View style={[styles.classBadge, c.classification === 'DIRECT_COMPETITOR' ? styles.badgeDirect : styles.badgeAdjacent]}>
                      <Text style={styles.classBadgeText}>{c.classification.replace('_', ' ')}</Text>
                    </View>
                  </View>
                  <Text style={styles.compReason}>{c.reason}</Text>
                </Pressable>
              ))}

              {!isAddingManualComp ? (
                <Pressable style={styles.addOutlineBtn} onPress={() => setIsAddingManualComp(true)}>
                  <Feather name="plus" size={14} color="#8B5CF6" />
                  <Text style={styles.addOutlineBtnText}>Add Competitor Manually</Text>
                </Pressable>
              ) : (
                <View style={styles.manualCompForm}>
                  <TextInput
                    style={styles.inputStandalone}
                    placeholder="Competitor Name (e.g. Hootsuite)"
                    placeholderTextColor="#475569"
                    value={manualCompName}
                    onChangeText={setManualCompName}
                  />
                  <TextInput
                    style={[styles.inputStandalone, { marginTop: 8 }]}
                    placeholder="Website URL (e.g. hootsuite.com)"
                    placeholderTextColor="#475569"
                    value={manualCompUrl}
                    onChangeText={setManualCompUrl}
                  />
                  <View style={styles.manualCompBtns}>
                    <Pressable style={styles.addBtnSmall} onPress={handleAddManualCompetitor}>
                      <Text style={styles.addBtnSmallText}>Add</Text>
                    </Pressable>
                    <Pressable onPress={() => setIsAddingManualComp(false)}>
                      <Text style={styles.cancelLink}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.btnRow}>
              <Pressable style={styles.secondaryBtn} onPress={() => setCurrentStep(4)}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={handleApproveCompetitors}>
                <Text style={styles.primaryBtnText}>Approve & Continue</Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}

        {currentStep === 6 && (() => {
          const approvedCount = candidateCompetitors.filter((c) => c.selected).length;
          const isCoverageMet = approvedCount >= 10;
          const heroProductDisplay = customProductName || (selectedProductId && productCatalogue.find(p => p.id === selectedProductId)?.name) || 'summer hijabi dresses';
          const isStrategyReady = isCoverageMet;

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.stepNumberBadge, !isStrategyReady && { borderColor: '#F59E0B', backgroundColor: '#2E1A05' }]}>
                  <Text style={[styles.stepNumberText, !isStrategyReady && { color: '#F59E0B' }]}>06</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{isStrategyReady ? 'Your Campaign Is Ready' : 'Setup Needs Attention'}</Text>
                  <Text style={styles.cardSubtitle}>
                    {isStrategyReady 
                      ? 'All canonical intelligence and competitor baselines have been assembled.' 
                      : (approvedCount < 10 
                          ? `Competitor coverage: ${approvedCount} / 10 verified. Minimum 10 approved competitors required.`
                          : 'Business understanding is still being completed.')}
                  </Text>
                </View>
              </View>

              {!isCoverageMet && (
                <View style={{ backgroundColor: '#1C1608', borderWidth: 1, borderColor: '#F59E0B', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#F59E0B', marginBottom: 4 }}>
                    ⚠️ Competitor Coverage Incomplete ({approvedCount}/10 Verified)
                  </Text>
                  <Text style={{ fontSize: 12, color: '#FDE68A', marginBottom: 10 }}>
                    Avyron requires at least 10 approved competitor entities to build comprehensive market intelligence, strategy matrices, and Watchtower monitors.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable 
                      style={{ backgroundColor: '#D97706', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                      onPress={() => setCurrentStep(5)}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>Review / Add Competitors</Text>
                    </Pressable>
                    <Pressable 
                      style={{ backgroundColor: '#292524', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                      onPress={handleRetryDiscovery}
                    >
                      <Text style={{ color: '#D4D4D8', fontSize: 12, fontWeight: '600' }}>Retry Discovery</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.summaryBox}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Company:</Text>
                  <Text style={styles.summaryValue}>{companyName || 'Sara-ft'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Hero Product:</Text>
                  <Text style={styles.summaryValue}>{heroProductDisplay}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Target Market:</Text>
                  <Text style={styles.summaryValue}>{targetMarket}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Competitors:</Text>
                  <Text style={[styles.summaryValue, !isCoverageMet && { color: '#F59E0B', fontWeight: '700' }]}>
                    {approvedCount} Approved {!isCoverageMet ? '(10 required)' : ''}
                  </Text>
                </View>
              </View>

              <Pressable
                style={[styles.primaryBtnLarge, (!isStrategyReady || isLoading) && styles.btnDisabled]}
                onPress={handleBuildStrategy}
                disabled={!isStrategyReady || isLoading}
              >
                <LinearGradient
                  colors={isStrategyReady ? ['#8B5CF6', '#6D28D9'] : ['#475569', '#334155']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientBtn}
                >
                  <Text style={styles.primaryBtnLargeText}>Build My Strategy</Text>
                  <Feather name="zap" size={18} color="#FFFFFF" />
                </LinearGradient>
              </Pressable>
            </View>
          );
        })()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0D14',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  badge: {
    backgroundColor: '#2E1065',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#6D28D9',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  stepIndicator: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A78BFA',
    letterSpacing: 0.5,
  },
  progressBarBg: {
    height: 3,
    backgroundColor: '#1E293B',
    width: '100%',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
    maxWidth: 700,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  stepNumberBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1E1838',
    borderWidth: 1,
    borderColor: '#382D5C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#A78BFA',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A0D14',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 44,
    color: '#F8FAFC',
    fontSize: 14,
  },
  inputStandalone: {
    backgroundColor: '#0A0D14',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
  },
  previewBox: {
    backgroundColor: '#0A0D14',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 16,
  },
  previewTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A78BFA',
    marginBottom: 4,
  },
  previewItem: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 2,
  },
  bold: {
    fontWeight: '600',
    color: '#E2E8F0',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    backgroundColor: '#0A0D14',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  chipActive: {
    backgroundColor: '#2E1065',
    borderColor: '#8B5CF6',
  },
  chipText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  productList: {
    gap: 10,
    marginBottom: 16,
  },
  productCard: {
    backgroundColor: '#0A0D14',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  productCardActive: {
    borderColor: '#8B5CF6',
    backgroundColor: '#1E1838',
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  productName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  productDesc: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
  },
  addOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#382D5C',
    borderStyle: 'dashed',
  },
  addOutlineBtnText: {
    fontSize: 12,
    color: '#A78BFA',
    fontWeight: '600',
  },
  customProductBox: {
    backgroundColor: '#0A0D14',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  cancelLink: {
    fontSize: 11,
    color: '#8B5CF6',
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  channelRow: {
    marginBottom: 12,
  },
  channelLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
    marginBottom: 4,
  },
  channelInput: {
    backgroundColor: '#0A0D14',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 13,
  },
  compList: {
    gap: 10,
    marginBottom: 16,
  },
  compCard: {
    backgroundColor: '#0A0D14',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    opacity: 0.6,
  },
  compCardActive: {
    borderColor: '#8B5CF6',
    opacity: 1,
    backgroundColor: '#1E1838',
  },
  compTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  compInfo: {
    flex: 1,
  },
  compName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  compUrl: {
    fontSize: 11,
    color: '#64748B',
  },
  classBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeDirect: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  badgeAdjacent: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  classBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  compReason: {
    fontSize: 11,
    color: '#94A3B8',
  },
  manualCompForm: {
    backgroundColor: '#0A0D14',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  manualCompBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  addBtnSmall: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addBtnSmallText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  summaryBox: {
    backgroundColor: '#0A0D14',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 8,
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginLeft: 8,
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  primaryBtnLarge: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  gradientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  primaryBtnLargeText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    flex: 1,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E1838',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#382D5C',
    marginBottom: 16,
  },
  statusText: {
    fontSize: 12,
    color: '#C4B5FD',
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  formIntroBox: {
    marginBottom: 16,
  },
  formIntroTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  formIntroHelper: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  providerErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    marginBottom: 16,
  },
  providerErrorTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F59E0B',
    marginBottom: 4,
  },
  providerErrorText: {
    fontSize: 12,
    color: '#FCD34D',
    lineHeight: 16,
  },
  retryBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D97706',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'center',
  },
  retryBtnSmallText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  noCompBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  noCompText: {
    fontSize: 12,
    color: '#94A3B8',
    flex: 1,
    lineHeight: 16,
  },
});