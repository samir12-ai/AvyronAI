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
  const [classificationProfile, setClassificationProfile] = useState<any>(null);
  const [evidenceGaps, setEvidenceGaps] = useState<string[]>([]);
  const [isCanonicalBU, setIsCanonicalBU] = useState<boolean>(false);
  const [productCatalogue, setProductCatalogue] = useState<Array<{ id: string; name: string; description: string }>>([]);

  const [targetMarket, setTargetMarket] = useState<string>('United Arab Emirates');
  const marketOptions = ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Egypt', 'Lebanon', 'United Kingdom', 'United States'];

  const [monthlyBudget, setMonthlyBudget] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const currencyOptions = ['USD', 'AED', 'SAR', 'EUR', 'GBP', 'QAR', 'KWD'];

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
    domain?: string;
    canonicalEntityId?: string;
    storefronts?: any[];
    geographicClassification?: string;
    geographicReasoning?: string;
    marketAvailabilityUncertainty?: string;
    sourcePageType?: string;
    evidenceSourceType?: string;
    classification: string;
    tier?: string;
    reason: string;
    selected: boolean;
  }>>([]);
  const [manualCompName, setManualCompName] = useState<string>('');
  const [manualCompUrl, setManualCompUrl] = useState<string>('');
  const [isAddingManualComp, setIsAddingManualComp] = useState<boolean>(false);

  const [campaignId, setCampaignId] = useState<string>(
    params.mode === 'new' ? '' : ((params.campaignId as string) || selectedCampaign?.selectedCampaignId || '')
  );
  const [discoveryStatus, setDiscoveryStatus] = useState<string>('DISCOVERY_COMPLETE');
  const [discoveryMessage, setDiscoveryMessage] = useState<string>('');
  const [readinessState, setReadinessState] = useState<any>(null);

  // Multi-campaign product-focused setup state
  const [isNewCampaignMode, setIsNewCampaignMode] = useState<boolean>(params.mode === 'new');
  const [workspaceBusinesses, setWorkspaceBusinesses] = useState<any[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [reusableChannelsList, setReusableChannelsList] = useState<any[]>([]);
  const [draftCampaignId, setDraftCampaignId] = useState<string>('');
  const [newCampaignName, setNewCampaignName] = useState<string>('');
  const [newCampaignGoal, setNewCampaignGoal] = useState<string>('SALES');
  const [newProductMode, setNewProductMode] = useState<'EXISTING' | 'NEW'>('NEW');
  const [existingProductSelectionId, setExistingProductSelectionId] = useState<string>('');
  const [newProductType, setNewProductType] = useState<string>('SERVICE');
  const [newProductUrl, setNewProductUrl] = useState<string>('');
  const [newProductDocUrl, setNewProductDocUrl] = useState<string>('');
  const [newProductCapabilities, setNewProductCapabilities] = useState<string>('');
  const [newProductPricing, setNewProductPricing] = useState<string>('');
  const [newProductPurchaseModel, setNewProductPurchaseModel] = useState<string>('');
  const [buEvidenceProvenance, setBuEvidenceProvenance] = useState<any>(null);
  const [buInputSnapshotVersion, setBuInputSnapshotVersion] = useState<string>('');
  const [competitorRelevanceDecisions, setCompetitorRelevanceDecisions] = useState<any[]>([]);

  useEffect(() => {
    if (params.mode === 'new') {
      setIsNewCampaignMode(true);
      setCampaignId('');
      setCurrentStep(1);
    }
  }, [params.mode]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(getApiUrl('/api/setup/businesses'));
        const json = await safeApiJson(res);
        if (json.success && Array.isArray(json.businesses) && json.businesses.length > 0) {
          setWorkspaceBusinesses(json.businesses);
          const firstBiz = json.businesses[0];
          setSelectedBusinessId(firstBiz.id);
          if (params.mode === 'new') {
            setCompanyName(firstBiz.name || '');
            setWebsiteUrl(firstBiz.websiteUrl || '');
            setIndustry(firstBiz.industry || '');
            setBusinessModel(firstBiz.businessModel || '');
          }
          if (Array.isArray(json.reusableChannels)) {
            setReusableChannelsList(json.reusableChannels);
            if (params.mode === 'new') {
              const chMap: any = { instagram: '', tiktok: '', youtube: '', linkedin: '', x: '' };
              json.reusableChannels.forEach((c: any) => {
                const plat = String(c.platform || '').toLowerCase();
                if (chMap[plat] !== undefined) chMap[plat] = c.url || c.handle || '';
              });
              setOwnedChannels(chMap);
            }
          }
        }
      } catch (err) {
        console.warn('[SetupScreen] Load workspace businesses warning:', err);
      }
    })();
  }, [params.mode]);

  useEffect(() => {
    if (selectedCampaign?.selectedCampaignId && !campaignId && !isNewCampaignMode) {
      setCampaignId(selectedCampaign.selectedCampaignId);
    }
  }, [selectedCampaign?.selectedCampaignId, campaignId, isNewCampaignMode]);

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
          if (json.classificationProfile) setClassificationProfile(json.classificationProfile);
          if (Array.isArray(json.evidenceGaps)) setEvidenceGaps(json.evidenceGaps);
          if (typeof json.isCanonicalBusinessUnderstanding === 'boolean') {
            setIsCanonicalBU(json.isCanonicalBusinessUnderstanding);
          }
          if (json.targetMarket) setTargetMarket(json.targetMarket);
          if (json.budget) {
            if (json.budget.monthlyBudget != null) setMonthlyBudget(String(json.budget.monthlyBudget));
            if (json.budget.currency) setCurrency(json.budget.currency);
          }
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
          if (json.readiness) {
            setReadinessState(json.readiness);
          }
          if (json.evidenceProvenance) {
            setBuEvidenceProvenance(json.evidenceProvenance);
          }
          if (json.inputSnapshotVersion) {
            setBuInputSnapshotVersion(json.inputSnapshotVersion);
          }
          if (Array.isArray(json.competitorRelevanceDecisions)) {
            setCompetitorRelevanceDecisions(json.competitorRelevanceDecisions);
          }

          if (json.discoverySession && Array.isArray(json.discoverySession.candidates)) {
            const approvedList = json.discoverySession.candidates.filter(
              (c: any) => !c.judgeVerdict || c.judgeVerdict === 'APPROVED' || c.judgeVerdict === 'APPROVED_FOR_REVIEW'
            );
            setCandidateCompetitors(
              approvedList.map((c: any) => ({
                name: c.name,
                websiteUrl: c.websiteUrl,
                domain: c.domain,
                canonicalEntityId: c.canonicalEntityId,
                storefronts: c.storefronts,
                geographicClassification: c.geographicClassification || 'UNVERIFIED',
                geographicReasoning: c.geographicReasoning,
                marketAvailabilityUncertainty: c.marketAvailabilityUncertainty,
                sourcePageType: c.sourcePageType,
                evidenceSourceType: c.evidenceSourceType,
                classification: c.classification || 'DIRECT_COMPETITOR',
                reason: c.relevanceReason || c.judgeReason || c.reason || 'Discovered competitor',
                tier: c.tier || 'B',
                selected: typeof c.selected === 'boolean' ? c.selected : true,
              }))
            );
          } else if (Array.isArray(json.competitors) && json.competitors.length > 0) {
            setCandidateCompetitors(
              json.competitors.map((c: any) => ({
                ...c,
                geographicClassification: c.geographicClassification || 'UNVERIFIED',
                classification: c.classification || 'DIRECT_COMPETITOR',
                reason: c.reason || 'Approved competitor',
                selected: true,
              }))
            );
          }

          const activeStep = json.currentStep || json.step;
          if (activeStep === '02_MARKET') setCurrentStep(2);
          else if (activeStep === '03_FOCUS') setCurrentStep(3);
          else if (activeStep === '04_CHANNELS') setCurrentStep(4);
          else if (activeStep === '05_COMPETITORS') setCurrentStep(5);
          else if (activeStep === '06_READY') setCurrentStep(6);
        }
      } catch (err) {
        console.warn('[SetupScreen] Resume check failed:', err);
      }
    })();
  }, [campaignId]);

  const applyDiscoveryResponse = (compJson: any) => {
    if (compJson.status) {
      setDiscoveryStatus(compJson.status);
      setDiscoveryMessage(compJson.message || '');
    }
    if (compJson.readiness) {
      setReadinessState(compJson.readiness);
    }
    if (compJson.pinnedContext) {
      if (compJson.pinnedContext.businessName) setCompanyName(compJson.pinnedContext.businessName);
      if (compJson.pinnedContext.category) setIndustry(compJson.pinnedContext.category);
      if (compJson.pinnedContext.businessModel) setBusinessModel(compJson.pinnedContext.businessModel);
      if (compJson.pinnedContext.classificationProfile) {
        setClassificationProfile(compJson.pinnedContext.classificationProfile);
      }
    }
    if (Array.isArray(compJson.candidates)) {
      setCandidateCompetitors(
        compJson.candidates.map((c: any) => ({
          ...c,
          geographicClassification: c.geographicClassification || 'UNVERIFIED',
          selected: typeof c.selected === 'boolean' ? c.selected : true,
        }))
      );
    }
  };

  const handleCreateNewProductCampaign = async () => {
    const selectedBiz = workspaceBusinesses.find((b) => b.id === selectedBusinessId) || workspaceBusinesses[0];
    const existingProd =
      newProductMode === 'EXISTING' && selectedBiz?.products
        ? selectedBiz.products.find((p: any) => p.id === existingProductSelectionId)
        : null;

    const finalProductName = existingProd ? existingProd.name : customProductName.trim();
    if (!finalProductName) {
      setErrorMessage('Please enter or select a product or service for this campaign.');
      return;
    }
    if (!targetMarket.trim()) {
      setErrorMessage('Please select a target market for this campaign.');
      return;
    }

    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Running product-focused Business Understanding & isolating campaign context...');

    const channelsToSave: Array<{ platform: string; handle: string }> = [];
    if (ownedChannels.instagram.trim()) channelsToSave.push({ platform: 'instagram', handle: ownedChannels.instagram.trim() });
    if (ownedChannels.tiktok.trim()) channelsToSave.push({ platform: 'tiktok', handle: ownedChannels.tiktok.trim() });
    if (ownedChannels.youtube.trim()) channelsToSave.push({ platform: 'youtube', handle: ownedChannels.youtube.trim() });
    if (ownedChannels.linkedin.trim()) channelsToSave.push({ platform: 'linkedin', handle: ownedChannels.linkedin.trim() });
    if (ownedChannels.x.trim()) channelsToSave.push({ platform: 'x', handle: ownedChannels.x.trim() });

    const parsedBudget = monthlyBudget.trim() === '' ? null : parseFloat(monthlyBudget.trim());

    try {
      const res = await authFetch(getApiUrl('/api/setup/create-new-campaign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftCampaignId: draftCampaignId || undefined,
          businessId: selectedBiz?.id || undefined,
          companyName: selectedBiz?.name || companyName.trim(),
          websiteUrl: selectedBiz?.websiteUrl || websiteUrl.trim(),
          industry: selectedBiz?.industry || industry.trim(),
          businessModel: selectedBiz?.businessModel || businessModel.trim(),
          productId: existingProd ? existingProd.id : undefined,
          productName: finalProductName,
          productType: existingProd ? existingProd.productType : newProductType,
          productDescription: existingProd ? existingProd.description : customProductNotes.trim(),
          productUrl: existingProd ? existingProd.productUrl : newProductUrl.trim(),
          documentationUrls: newProductDocUrl.trim() ? [newProductDocUrl.trim()] : [],
          verifiedCapabilities: newProductCapabilities
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          pricingModel: newProductPricing.trim() || undefined,
          purchaseModel: newProductPurchaseModel.trim() || undefined,
          campaignName: newCampaignName.trim() || `${selectedBiz?.name || companyName || 'Campaign'} — ${finalProductName} (${targetMarket.trim()})`,
          campaignGoalType: newCampaignGoal || 'SALES',
          targetMarket: targetMarket.trim(),
          monthlyBudget: parsedBudget !== null && !isNaN(parsedBudget) ? parsedBudget : null,
          currency: currency || 'USD',
          channels: channelsToSave,
        }),
      });
      const json = await safeApiJson(res);
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || 'Failed to create product campaign');
      }

      const createdCampId = json.campaignId;
      setDraftCampaignId(createdCampId);
      setCampaignId(createdCampId);
      setCustomProductName(finalProductName);
      if (json.canonicalBusinessUnderstanding) {
        const cbu = json.canonicalBusinessUnderstanding;
        if (cbu.companyName) setCompanyName(cbu.companyName);
        if (cbu.industry) setIndustry(cbu.industry);
        if (cbu.businessModel) setBusinessModel(cbu.businessModel);
        if (cbu.classificationProfile) setClassificationProfile(cbu.classificationProfile);
        if (cbu.evidenceProvenance) setBuEvidenceProvenance(cbu.evidenceProvenance);
        if (cbu.inputSnapshotVersion) setBuInputSnapshotVersion(cbu.inputSnapshotVersion);
        setIsCanonicalBU(true);
      }

      await refreshCampaigns();
      await refreshSelection();

      setStatusMessage('Discovering product-specific competitors for ' + finalProductName + '...');
      const compRes = await authFetch(getApiUrl('/api/setup/discover-competitors'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: createdCampId }),
      });
      const compJson = await safeApiJson(compRes);
      applyDiscoveryResponse(compJson);
      setIsNewCampaignMode(false);
      setStatusMessage('');
      setCurrentStep(5);
    } catch (err: any) {
      setErrorMessage(err.message || 'Product campaign creation failed.');
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

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
        setClassificationProfile(json.data.classificationProfile || null);
        setEvidenceGaps(Array.isArray(json.data.evidenceGaps) ? json.data.evidenceGaps : []);
        setIsCanonicalBU(false);
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
        const errText = json.referenceId
          ? `${json.error || 'Website analysis failed'} (Ref: ${json.referenceId})`
          : (json.error || 'Website analysis failed');
        throw new Error(errText);
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
      const marketRes = await authFetch(getApiUrl('/api/setup/save-market'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          targetMarket: targetMarket.trim(),
        }),
      });
      const marketJson = await safeApiJson(marketRes);
      if (marketJson?.discoveryInvalidated) {
        setCandidateCompetitors([]);
        setReadinessState(null);
      }

      const parsedBudget = monthlyBudget.trim() === '' ? null : parseFloat(monthlyBudget.trim());
      await authFetch(getApiUrl('/api/setup/save-budget'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          monthlyBudget: parsedBudget !== null && !isNaN(parsedBudget) ? parsedBudget : null,
          currency: currency || 'USD',
        }),
      }).catch((e) => console.warn('[Setup] Save budget non-blocking error:', e));

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
        setCustomProductName(offeringName);
        if (json.canonicalBusinessUnderstanding) {
          const cbu = json.canonicalBusinessUnderstanding;
          if (cbu.companyName) setCompanyName(cbu.companyName);
          if (cbu.industry) setIndustry(cbu.industry);
          if (cbu.businessModel) setBusinessModel(cbu.businessModel);
          if (cbu.classificationProfile) setClassificationProfile(cbu.classificationProfile);
          if (Array.isArray(cbu.evidenceGaps)) setEvidenceGaps(cbu.evidenceGaps);
          if (Array.isArray(cbu.productCatalogue) && cbu.productCatalogue.length > 0) {
            setProductCatalogue(cbu.productCatalogue);
          }
          setIsCanonicalBU(true);
        }
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
      applyDiscoveryResponse(compJson);
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
      applyDiscoveryResponse(compJson);
    } catch (err: any) {
      setErrorMessage(err.message || 'Competitor discovery retry failed.');
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleContinueDiscovery = async () => {
    if (!campaignId) return;
    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Running targeted follow-up discovery for remaining evidence gaps...');
    try {
      const selectedDomains = candidateCompetitors
        .filter((c) => c.selected)
        .map((c) => c.domain || c.websiteUrl)
        .filter(Boolean);

      const compRes = await authFetch(getApiUrl('/api/setup/discover-competitors'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          resumeSession: true,
          selectedDomains,
        }),
      });
      const compJson = await safeApiJson(compRes);
      applyDiscoveryResponse(compJson);
    } catch (err: any) {
      setErrorMessage(err.message || 'Competitor discovery expansion failed.');
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

    if (approved.length === 0) {
      setErrorMessage('Please select at least one relevant competitor to proceed.');
      return;
    }

    setErrorMessage('');
    setIsLoading(true);
    setStatusMessage('Registering selected competitors and initializing Watchtower monitoring...');

    try {
      const res = await authFetch(getApiUrl('/api/setup/approve-competitors'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          approvedCompetitors: approved,
        }),
      });
      const json = await safeApiJson(res);
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || 'Failed to approve competitors.');
      }
      setStatusMessage('');
      setCurrentStep(6);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to approve competitors.');
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleAddManualCompetitor = () => {
    if (!manualCompName.trim()) return;
    let url = manualCompUrl.trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const cleanUrl = url || ('https://' + manualCompName.toLowerCase().replace(/\s+/g, '') + '.com');
    setCandidateCompetitors((prev) => [
      ...prev,
      {
        name: manualCompName.trim(),
        websiteUrl: cleanUrl,
        classification: 'DIRECT_COMPETITOR',
        geographicClassification: 'UNVERIFIED',
        marketAvailabilityUncertainty: `Manually added by user; market availability in ${targetMarket} will be verified during analysis.`,
        reason: 'User-specified competitor entity.',
        tier: 'A',
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
            <Text style={styles.badgeText}>{isNewCampaignMode ? 'NEW PRODUCT CAMPAIGN' : 'SETUP'}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={() => router.replace('/(tabs)')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#1E293B' }}
            testID="setup-back-to-dashboard"
          >
            <Feather name="arrow-left" size={13} color="#CBD5E1" />
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#CBD5E1' }}>Dashboard</Text>
          </Pressable>
          <Text style={styles.stepIndicator}>{isNewCampaignMode ? 'PRODUCT SETUP' : `STEP ${currentStep} OF 6`}</Text>
        </View>
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

        {currentStep === 1 && isNewCampaignMode && (() => {
          const activeBiz = workspaceBusinesses.find((b) => b.id === selectedBusinessId) || workspaceBusinesses[0] || null;
          const existingProducts: any[] = Array.isArray(activeBiz?.products) ? activeBiz.products : [];
          const productTypes = [
            { id: 'SERVICE', label: 'Service Offering' },
            { id: 'DIGITAL_PRODUCT', label: 'Digital Product' },
            { id: 'SAAS', label: 'SaaS / Platform' },
            { id: 'PHYSICAL_PRODUCT', label: 'Physical Product' },
            { id: 'HYBRID_OFFERING', label: 'Hybrid Offering' },
          ];
          const goalTypes = ['SALES', 'LEADS', 'AWARENESS', 'RETARGETING', 'TESTING'];

          return (
            <View style={styles.card} testID="product-focused-new-campaign-card">
              <View style={styles.cardHeader}>
                <View style={styles.stepNumberBadge}>
                  <Text style={styles.stepNumberText}>NEW</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Product-Focused New Campaign Setup</Text>
                  <Text style={styles.cardSubtitle}>
                    Confirm your reusable company facts and define the specific product or service, target market, goal, and budget for this isolated campaign.
                  </Text>
                </View>
              </View>

              {/* 1. Confirm Reusable Business Identity */}
              {activeBiz ? (
                <View style={[styles.previewBox, { borderColor: '#6D28D9', backgroundColor: '#1E1B4B40', marginBottom: 18 }]} testID="reusable-company-facts-box">
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={[styles.previewTitle, { color: '#C4B5FD', marginBottom: 0 }]}>
                      ✓ Reusable Workspace Business Confirmed (Inherited Company Facts Only)
                    </Text>
                    <View style={{ backgroundColor: '#065F46', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#6EE7B7' }}>REUSED_FROM_CACHE</Text>
                    </View>
                  </View>
                  <Text style={styles.previewItem}>• <Text style={styles.bold}>Company:</Text> {activeBiz.name} ({activeBiz.websiteUrl})</Text>
                  <Text style={styles.previewItem}>• <Text style={styles.bold}>Industry & Model:</Text> {activeBiz.industry} • {activeBiz.businessModel}</Text>
                  {activeBiz.verifiedCompanyFacts?.companySummary ? (
                    <Text style={styles.previewItem}>• <Text style={styles.bold}>Verified Summary:</Text> {activeBiz.verifiedCompanyFacts.companySummary}</Text>
                  ) : null}
                  <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                    Note: Existing campaign strategies, audience lanes, selected competitors, and product claims are NOT copied into this new campaign.
                  </Text>
                </View>
              ) : (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Company Name & Website</Text>
                  <TextInput
                    style={styles.inputStandalone}
                    placeholder="Company Name"
                    placeholderTextColor="#475569"
                    value={companyName}
                    onChangeText={setCompanyName}
                  />
                  <TextInput
                    style={[styles.inputStandalone, { marginTop: 8 }]}
                    placeholder="https://yourcompany.com"
                    placeholderTextColor="#475569"
                    value={websiteUrl}
                    onChangeText={setWebsiteUrl}
                  />
                </View>
              )}

              {/* 2. Choose Existing Product or Define New Product/Service */}
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.label}>Offering Selection Mode</Text>
                <View style={styles.chipGrid}>
                  <Pressable
                    style={[styles.chip, newProductMode === 'NEW' && styles.chipActive]}
                    onPress={() => setNewProductMode('NEW')}
                    testID="mode-new-product-btn"
                  >
                    <Text style={[styles.chipText, newProductMode === 'NEW' && styles.chipTextActive]}>
                      + New Product or Service
                    </Text>
                  </Pressable>
                  {existingProducts.length > 0 && (
                    <Pressable
                      style={[styles.chip, newProductMode === 'EXISTING' && styles.chipActive]}
                      onPress={() => {
                        setNewProductMode('EXISTING');
                        if (!existingProductSelectionId && existingProducts[0]) {
                          setExistingProductSelectionId(existingProducts[0].id);
                        }
                      }}
                      testID="mode-existing-product-btn"
                    >
                      <Text style={[styles.chipText, newProductMode === 'EXISTING' && styles.chipTextActive]}>
                        Existing Product ({existingProducts.length} available)
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>

              {newProductMode === 'EXISTING' && existingProducts.length > 0 ? (
                <View style={{ marginBottom: 16 }}>
                  <Text style={styles.label}>Select Existing Product (for a new market or goal)</Text>
                  {existingProducts.map((p: any) => (
                    <Pressable
                      key={p.id}
                      style={[styles.productCard, existingProductSelectionId === p.id && styles.productCardActive]}
                      onPress={() => setExistingProductSelectionId(p.id)}
                    >
                      <View style={styles.productHeader}>
                        <Text style={styles.productName}>{p.name} ({p.productType})</Text>
                        {existingProductSelectionId === p.id && (
                          <Ionicons name="checkmark-circle" size={18} color="#8B5CF6" />
                        )}
                      </View>
                      <Text style={styles.productDesc}>{p.description || 'Verified workspace product'}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={{ marginBottom: 16 }}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Product or Service Name *</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="e.g. Corporate Team Anthem & Event Song Service"
                      placeholderTextColor="#475569"
                      value={customProductName}
                      onChangeText={setCustomProductName}
                      testID="new-product-name-input"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Offering Type (Supports Services, SaaS, Digital & Physical Products)</Text>
                    <View style={styles.chipGrid}>
                      {productTypes.map((pt) => (
                        <Pressable
                          key={pt.id}
                          style={[styles.chip, newProductType === pt.id && styles.chipActive]}
                          onPress={() => setNewProductType(pt.id)}
                          testID={`product-type-${pt.id}`}
                        >
                          <Text style={[styles.chipText, newProductType === pt.id && styles.chipTextActive]}>
                            {pt.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Product / Service Description & Use Case *</Text>
                    <TextInput
                      style={[styles.inputStandalone, { height: 76 }]}
                      placeholder="Describe what this specific offering delivers, who buys it, and the problem it solves..."
                      placeholderTextColor="#475569"
                      value={customProductNotes}
                      onChangeText={setCustomProductNotes}
                      multiline
                      testID="new-product-description-input"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Product / Service Page URL & Documentation (Optional — no e-commerce page required)</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="e.g. https://thesongai.com/corporate-gifting (optional)"
                      placeholderTextColor="#475569"
                      value={newProductUrl}
                      onChangeText={setNewProductUrl}
                      testID="new-product-url-input"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Verified Capabilities (comma-separated)</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="e.g. B2B bulk licensing, custom brand storytelling, 48-hour studio turnaround"
                      placeholderTextColor="#475569"
                      value={newProductCapabilities}
                      onChangeText={setNewProductCapabilities}
                      testID="new-product-capabilities-input"
                    />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Pricing Model</Text>
                      <TextInput
                        style={styles.inputStandalone}
                        placeholder="e.g. Custom B2B packages from $499"
                        placeholderTextColor="#475569"
                        value={newProductPricing}
                        onChangeText={setNewProductPricing}
                        testID="new-product-pricing-input"
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Purchase Model</Text>
                      <TextInput
                        style={styles.inputStandalone}
                        placeholder="e.g. Consultation / Invoice or Direct Checkout"
                        placeholderTextColor="#475569"
                        value={newProductPurchaseModel}
                        onChangeText={setNewProductPurchaseModel}
                        testID="new-product-purchase-model-input"
                      />
                    </View>
                  </View>
                </View>
              )}

              {/* 3. Target Market, Goal & Budget */}
              <View style={{ marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#1E293B' }}>
                <Text style={styles.label}>Target Geographic Market *</Text>
                <View style={styles.chipGrid}>
                  {marketOptions.map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.chip, targetMarket === m && styles.chipActive]}
                      onPress={() => setTargetMarket(m)}
                      testID={`market-chip-${m}`}
                    >
                      <Text style={[styles.chipText, targetMarket === m && styles.chipTextActive]}>{m}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.label, { marginTop: 10 }]}>Campaign Goal *</Text>
                <View style={styles.chipGrid}>
                  {goalTypes.map((g) => (
                    <Pressable
                      key={g}
                      style={[styles.chip, newCampaignGoal === g && styles.chipActive]}
                      onPress={() => setNewCampaignGoal(g)}
                      testID={`goal-chip-${g}`}
                    >
                      <Text style={[styles.chipText, newCampaignGoal === g && styles.chipTextActive]}>{g}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Campaign Name (Optional)</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="Auto-generated from product & market if blank"
                      placeholderTextColor="#475569"
                      value={newCampaignName}
                      onChangeText={setNewCampaignName}
                      testID="new-campaign-custom-name-input"
                    />
                  </View>
                  <View style={[styles.inputGroup, { width: 180 }]}>
                    <Text style={styles.label}>Monthly Budget ({currency})</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="e.g. 2500"
                      placeholderTextColor="#475569"
                      keyboardType="numeric"
                      value={monthlyBudget}
                      onChangeText={setMonthlyBudget}
                      testID="new-campaign-budget-input"
                    />
                  </View>
                </View>
              </View>

              {/* 4. Relevant Owned Channels (Shared Without Duplicate Scraping) */}
              <View style={{ marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#1E293B', marginBottom: 16 }}>
                <Text style={styles.label}>
                  Relevant Owned Social Channels (Reuses verified workspace snapshots without re-scraping)
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Instagram</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="@yourhandle"
                      placeholderTextColor="#475569"
                      value={ownedChannels.instagram}
                      onChangeText={(v) => setOwnedChannels((p) => ({ ...p, instagram: v }))}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>TikTok</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="@yourhandle"
                      placeholderTextColor="#475569"
                      value={ownedChannels.tiktok}
                      onChangeText={(v) => setOwnedChannels((p) => ({ ...p, tiktok: v }))}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>YouTube</Text>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="@channel"
                      placeholderTextColor="#475569"
                      value={ownedChannels.youtube}
                      onChangeText={(v) => setOwnedChannels((p) => ({ ...p, youtube: v }))}
                    />
                  </View>
                </View>
              </View>

              <Pressable
                style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                onPress={handleCreateNewProductCampaign}
                disabled={isLoading}
                testID="submit-new-product-campaign-btn"
              >
                <Text style={styles.primaryBtnText}>
                  {isLoading ? 'Running Product Understanding & Discovery...' : 'Create Product Campaign & Discover Competitors'}
                </Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          );
        })()}

        {currentStep === 1 && !isNewCampaignMode && (
          <View style={styles.card}>
            {workspaceBusinesses.length > 0 && (
              <Pressable
                style={{
                  backgroundColor: '#2E1065',
                  borderWidth: 1,
                  borderColor: '#7C3AED',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onPress={() => setIsNewCampaignMode(true)}
                testID="switch-to-new-product-campaign-mode"
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#DDD6FE' }}>
                    Creating another campaign for {workspaceBusinesses[0]?.name}?
                  </Text>
                  <Text style={{ fontSize: 11, color: '#C4B5FD', marginTop: 2 }}>
                    Skip full website setup and launch a product-specific campaign reusing your verified company facts.
                  </Text>
                </View>
                <Feather name="arrow-right-circle" size={18} color="#C4B5FD" />
              </Pressable>
            )}
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
                <Text style={styles.previewTitle}>
                  {isCanonicalBU ? 'Canonical Business Understanding:' : 'Preliminary Website Intelligence:'}
                </Text>
                <Text style={styles.previewItem}>• <Text style={styles.bold}>Company:</Text> {companyName}</Text>
                <Text style={styles.previewItem}>• <Text style={styles.bold}>Industry:</Text> {industry}</Text>
                <Text style={styles.previewItem}>• <Text style={styles.bold}>Summary Model:</Text> {businessModel}</Text>
                {(classificationProfile?.offeringAndDelivery?.value || classificationProfile?.offeringAndDelivery?.category) ? (
                  <Text style={styles.previewItem}>
                    • <Text style={styles.bold}>Offering & Delivery:</Text> {classificationProfile.offeringAndDelivery.value || classificationProfile.offeringAndDelivery.category}
                  </Text>
                ) : null}
                {(classificationProfile?.buyerSegment?.value || classificationProfile?.buyerSegment?.category) ? (
                  <Text style={styles.previewItem}>
                    • <Text style={styles.bold}>Buyer Segment:</Text> {classificationProfile.buyerSegment.value || classificationProfile.buyerSegment.category}
                  </Text>
                ) : null}
                {(classificationProfile?.monetization?.value || classificationProfile?.monetization?.category) ? (
                  <Text style={styles.previewItem}>
                    • <Text style={styles.bold}>Monetization:</Text> {classificationProfile.monetization.value || classificationProfile.monetization.category}
                  </Text>
                ) : null}
                {evidenceGaps.length > 0 ? (
                  <Text style={[styles.previewItem, { color: '#FDE68A', marginTop: 4 }]}>
                    • <Text style={styles.bold}>Evidence Gaps:</Text> {evidenceGaps.join(' | ')}
                  </Text>
                ) : null}
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

            {/* Monthly Marketing Budget Section */}
            <View style={{ marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1E293B' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Feather name="dollar-sign" size={16} color="#8B5CF6" style={{ marginRight: 6 }} />
                <Text style={styles.label}>Monthly Marketing Budget (Optional)</Text>
              </View>
              <Text style={{ fontSize: 12, color: '#94A3B8', marginBottom: 10, lineHeight: 17 }}>
                Enter your planned monthly spend. Avyron will generate a recommended allocation across channels. Enter 0 for organic-only, or leave blank if undecided.
              </Text>

              {/* Currency Selector */}
              <Text style={[styles.label, { fontSize: 12, marginBottom: 6, color: '#CBD5E1' }]}>Currency</Text>
              <View style={[styles.chipGrid, { marginBottom: 12 }]}>
                {currencyOptions.map((c) => (
                  <Pressable
                    key={c}
                    style={[styles.chip, currency === c && styles.chipActive]}
                    onPress={() => setCurrency(c)}
                  >
                    <Text style={[styles.chipText, currency === c && styles.chipTextActive]}>{c}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Budget Amount Input */}
              <TextInput
                style={styles.inputStandalone}
                placeholder="e.g. 5000 (or 0 for organic-only)"
                placeholderTextColor="#475569"
                keyboardType="numeric"
                value={monthlyBudget}
                onChangeText={setMonthlyBudget}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 2 }}>
                <Feather name="info" size={12} color="#A78BFA" style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 11, color: '#A78BFA' }}>
                  Recommended allocation only — no money is spent automatically.
                </Text>
              </View>
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
                    placeholder="e.g. AI Personalized Song Platform"
                    placeholderTextColor="#475569"
                    value={customProductName}
                    onChangeText={setCustomProductName}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Features, Pricing & Notes</Text>
                  <TextInput
                    style={[styles.inputStandalone, { height: 80 }]}
                    placeholder="e.g. Delivery model, B2B/B2C buyer segments, pricing tiers, and main use cases..."
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

        {currentStep === 5 && (() => {
          const localCandidates = candidateCompetitors.filter(
            (c) => c.geographicClassification === 'LOCAL_MARKET'
          );
          const crossBorderCandidates = candidateCompetitors.filter(
            (c) => c.geographicClassification === 'CROSS_BORDER_SERVING_MARKET'
          );
          const unverifiedCandidates = candidateCompetitors.filter(
            (c) => !c.geographicClassification || c.geographicClassification === 'UNVERIFIED'
          );
          const internationalCandidates = candidateCompetitors.filter(
            (c) => c.geographicClassification === 'INTERNATIONAL_REFERENCE'
          );

          const selectedAll = candidateCompetitors.filter((c) => c.selected);
          const selectedCount = selectedAll.length;
          const selectedDirectCount = selectedAll.filter(
            (c) => c.classification === 'DIRECT_COMPETITOR' || c.classification === 'RELEVANT_COMPETITOR'
          ).length;
          const selectedVerifiedMarketCount = selectedAll.filter(
            (c) => c.geographicClassification === 'LOCAL_MARKET' || c.geographicClassification === 'CROSS_BORDER_SERVING_MARKET'
          ).length;

          const canProceed = selectedCount >= 1 && readinessState?.discoveryHealth?.contextCompatible !== false;
          const effectiveVerdict = !canProceed
            ? 'BLOCKED'
            : readinessState?.verdict === 'READY' && selectedDirectCount > 0 && selectedVerifiedMarketCount > 0
              ? 'READY'
              : 'READY_WITH_LIMITED_EVIDENCE';

          const bannerBorderColor =
            effectiveVerdict === 'READY' ? '#10B981' : effectiveVerdict === 'READY_WITH_LIMITED_EVIDENCE' ? '#3B82F6' : '#F59E0B';
          const bannerBgColor =
            effectiveVerdict === 'READY' ? '#062419' : effectiveVerdict === 'READY_WITH_LIMITED_EVIDENCE' ? '#0C192E' : '#1C1608';
          const bannerTitleColor =
            effectiveVerdict === 'READY' ? '#34D399' : effectiveVerdict === 'READY_WITH_LIMITED_EVIDENCE' ? '#60A5FA' : '#F59E0B';

          const headline = !canProceed
            ? readinessState?.headline || 'Select At Least One Relevant Competitor to Proceed'
            : readinessState?.headline ||
              (effectiveVerdict === 'READY'
                ? 'Competitor Coverage Ready for Strategy Generation'
                : 'Ready to Proceed with Caveats (Limited Market Evidence)');

          const reason = !canProceed
            ? selectedCount === 0
              ? 'Select at least one relevant competitor from the cohorts below, or run Continue Discovery / Add Manually.'
              : readinessState?.reason || 'Additional competitor context is required before proceeding.'
            : readinessState?.reason ||
              `Selected ${selectedCount} relevant competitor(s) (${selectedDirectCount} direct, ${selectedVerifiedMarketCount} verified in ${targetMarket}).`;

          const materialGaps: string[] = Array.isArray(readinessState?.materialGaps) ? readinessState.materialGaps : [];

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.stepNumberBadge}>
                  <Text style={styles.stepNumberText}>05</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.cardTitle}>Competitor Discovery</Text>
                    <View
                      style={[
                        styles.classBadge,
                        effectiveVerdict === 'READY'
                          ? styles.badgeLocal
                          : effectiveVerdict === 'READY_WITH_LIMITED_EVIDENCE'
                            ? styles.badgeCrossBorder
                            : styles.badgeAdjacent,
                      ]}
                    >
                      <Text style={[styles.classBadgeText, { fontWeight: '700' }]}>
                        {effectiveVerdict === 'READY'
                          ? `READY (${selectedCount} Selected)`
                          : effectiveVerdict === 'READY_WITH_LIMITED_EVIDENCE'
                            ? `READY WITH CAVEATS (${selectedCount} Selected)`
                            : 'BLOCKED (0 Selected)'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cardSubtitle}>
                    Competitive relationship (direct, adjacent, substitute) is evaluated independently from market availability in {targetMarket || 'your target market'}.
                  </Text>
                </View>
              </View>

              {/* Contextual Readiness Banner */}
              <View
                style={{
                  backgroundColor: bannerBgColor,
                  borderWidth: 1,
                  borderColor: bannerBorderColor,
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Feather
                    name={effectiveVerdict === 'READY' ? 'check-circle' : effectiveVerdict === 'READY_WITH_LIMITED_EVIDENCE' ? 'info' : 'alert-triangle'}
                    size={16}
                    color={bannerTitleColor}
                  />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: bannerTitleColor }}>{headline}</Text>
                </View>
                <Text style={{ fontSize: 12, color: '#E2E8F0', marginBottom: 8, lineHeight: 17 }}>{reason}</Text>

                {readinessState?.offeringCoverage ? (
                  <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>
                    • <Text style={styles.bold}>Offering Coverage:</Text> {readinessState.offeringCoverage}
                  </Text>
                ) : null}
                {readinessState?.buyerSegmentCoverage ? (
                  <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>
                    • <Text style={styles.bold}>Buyer Segments:</Text> {readinessState.buyerSegmentCoverage}
                  </Text>
                ) : null}
                {readinessState?.marketApplicability ? (
                  <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>
                    • <Text style={styles.bold}>Market Applicability:</Text> {readinessState.marketApplicability}
                  </Text>
                ) : null}

                {materialGaps.length > 0 && (
                  <View style={{ marginBottom: 8 }}>
                    {materialGaps.map((gap, idx) => (
                      <Text key={idx} style={{ fontSize: 11, color: '#FDE68A', lineHeight: 16 }}>
                        ⚠️ {gap}
                      </Text>
                    ))}
                  </View>
                )}

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <Pressable
                    style={{
                      backgroundColor: '#8B5CF6',
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 6,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onPress={handleContinueDiscovery}
                  >
                    <Feather name="search" size={13} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>Continue Discovery</Text>
                  </Pressable>
                  <Pressable
                    style={{
                      backgroundColor: '#292524',
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 6,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onPress={() => setIsAddingManualComp(true)}
                  >
                    <Feather name="plus" size={13} color="#D4D4D8" />
                    <Text style={{ color: '#D4D4D8', fontSize: 12, fontWeight: '600' }}>Add Manually</Text>
                  </Pressable>
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

              <View style={styles.compList}>
                {/* Cohort 1: Verified Local Market Competitors */}
                {localCandidates.length > 0 && (
                  <>
                    <View style={styles.cohortHeader}>
                      <View>
                        <Text style={styles.cohortTitle}>📍 Verified Local Market Competitors ({localCandidates.length})</Text>
                        <Text style={styles.cohortSubtitle}>Verified domestic presence or active local operations in {targetMarket}</Text>
                      </View>
                    </View>
                    {localCandidates.map((c) => {
                      const globalIdx = candidateCompetitors.findIndex((item) => item.name === c.name && item.websiteUrl === c.websiteUrl);
                      return (
                        <Pressable
                          key={c.name + (c.canonicalEntityId || c.websiteUrl)}
                          style={[styles.compCard, c.selected && styles.compCardActive]}
                          onPress={() => {
                            setCandidateCompetitors((prev) =>
                              prev.map((item, idx) => (idx === globalIdx ? { ...item, selected: !item.selected } : item))
                            );
                          }}
                        >
                          <View style={styles.compTop}>
                            <View style={styles.compInfo}>
                              <Text style={styles.compName}>{c.name}</Text>
                              <Text style={styles.compUrl}>{c.websiteUrl}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              <View style={[styles.classBadge, styles.badgeLocal]}>
                                <Text style={styles.classBadgeText}>LOCAL MARKET</Text>
                              </View>
                              <View style={[styles.classBadge, c.classification === 'DIRECT_COMPETITOR' ? styles.badgeDirect : styles.badgeAdjacent]}>
                                <Text style={styles.classBadgeText}>{c.classification.replace(/_/g, ' ')}</Text>
                              </View>
                            </View>
                          </View>
                          <Text style={styles.compReason}>{c.reason || c.geographicReasoning}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                )}

                {/* Cohort 2: Verified Cross-Border Serving Target Market */}
                {crossBorderCandidates.length > 0 && (
                  <>
                    <View style={styles.cohortHeader}>
                      <View>
                        <Text style={styles.cohortTitle}>✈️ Cross-Border Serving {targetMarket} ({crossBorderCandidates.length})</Text>
                        <Text style={styles.cohortSubtitle}>International/regional providers with verified service to {targetMarket}</Text>
                      </View>
                    </View>
                    {crossBorderCandidates.map((c) => {
                      const globalIdx = candidateCompetitors.findIndex((item) => item.name === c.name && item.websiteUrl === c.websiteUrl);
                      return (
                        <Pressable
                          key={c.name + (c.canonicalEntityId || c.websiteUrl)}
                          style={[styles.compCard, c.selected && styles.compCardActive]}
                          onPress={() => {
                            setCandidateCompetitors((prev) =>
                              prev.map((item, idx) => (idx === globalIdx ? { ...item, selected: !item.selected } : item))
                            );
                          }}
                        >
                          <View style={styles.compTop}>
                            <View style={styles.compInfo}>
                              <Text style={styles.compName}>{c.name}</Text>
                              <Text style={styles.compUrl}>{c.websiteUrl}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              <View style={[styles.classBadge, styles.badgeCrossBorder]}>
                                <Text style={styles.classBadgeText}>SERVES MARKET</Text>
                              </View>
                              <View style={[styles.classBadge, c.classification === 'DIRECT_COMPETITOR' ? styles.badgeDirect : styles.badgeAdjacent]}>
                                <Text style={styles.classBadgeText}>{c.classification.replace(/_/g, ' ')}</Text>
                              </View>
                            </View>
                          </View>
                          <Text style={styles.compReason}>{c.reason || c.geographicReasoning}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                )}

                {/* Cohort 3: Relevant Competitors — Market Availability Unverified */}
                {unverifiedCandidates.length > 0 && (
                  <>
                    <View style={styles.cohortHeader}>
                      <View>
                        <Text style={styles.cohortTitle}>
                          🔍 Relevant Competitors — Market Availability Unverified ({unverifiedCandidates.length})
                        </Text>
                        <Text style={styles.cohortSubtitle}>
                          Direct, adjacent, or substitute competitors whose explicit availability in {targetMarket} is not yet verified
                        </Text>
                      </View>
                    </View>
                    {unverifiedCandidates.map((c) => {
                      const globalIdx = candidateCompetitors.findIndex((item) => item.name === c.name && item.websiteUrl === c.websiteUrl);
                      return (
                        <Pressable
                          key={c.name + (c.canonicalEntityId || c.websiteUrl)}
                          style={[styles.compCard, c.selected && styles.compCardActive]}
                          onPress={() => {
                            setCandidateCompetitors((prev) =>
                              prev.map((item, idx) => (idx === globalIdx ? { ...item, selected: !item.selected } : item))
                            );
                          }}
                        >
                          <View style={styles.compTop}>
                            <View style={styles.compInfo}>
                              <Text style={styles.compName}>{c.name}</Text>
                              <Text style={styles.compUrl}>{c.websiteUrl}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              <View style={[styles.classBadge, styles.badgeInternational]}>
                                <Text style={styles.classBadgeText}>MARKET UNVERIFIED</Text>
                              </View>
                              <View style={[styles.classBadge, c.classification === 'DIRECT_COMPETITOR' ? styles.badgeDirect : styles.badgeAdjacent]}>
                                <Text style={styles.classBadgeText}>{c.classification.replace(/_/g, ' ')}</Text>
                              </View>
                            </View>
                          </View>
                          <Text style={styles.compReason}>{c.reason}</Text>
                          {(c.marketAvailabilityUncertainty || c.geographicReasoning) ? (
                            <Text style={{ fontSize: 11, color: '#FDE68A', marginTop: 4 }}>
                              Note: {c.marketAvailabilityUncertainty || c.geographicReasoning}
                            </Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </>
                )}

                {/* Cohort 4: International Reference Competitors */}
                {internationalCandidates.length > 0 && (
                  <>
                    <View style={styles.cohortHeader}>
                      <View>
                        <Text style={styles.cohortTitle}>🌐 International Category Benchmarks ({internationalCandidates.length})</Text>
                        <Text style={styles.cohortSubtitle}>Global category leaders & reference platforms</Text>
                      </View>
                    </View>
                    {internationalCandidates.map((c) => {
                      const globalIdx = candidateCompetitors.findIndex((item) => item.name === c.name && item.websiteUrl === c.websiteUrl);
                      return (
                        <Pressable
                          key={c.name + (c.canonicalEntityId || c.websiteUrl)}
                          style={[styles.compCard, c.selected && styles.compCardActive]}
                          onPress={() => {
                            setCandidateCompetitors((prev) =>
                              prev.map((item, idx) => (idx === globalIdx ? { ...item, selected: !item.selected } : item))
                            );
                          }}
                        >
                          <View style={styles.compTop}>
                            <View style={styles.compInfo}>
                              <Text style={styles.compName}>{c.name}</Text>
                              <Text style={styles.compUrl}>{c.websiteUrl}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              <View style={[styles.classBadge, styles.badgeInternational]}>
                                <Text style={styles.classBadgeText}>INTERNATIONAL REFERENCE</Text>
                              </View>
                              <View style={[styles.classBadge, c.classification === 'DIRECT_COMPETITOR' ? styles.badgeDirect : styles.badgeAdjacent]}>
                                <Text style={styles.classBadgeText}>{c.classification.replace(/_/g, ' ')}</Text>
                              </View>
                            </View>
                          </View>
                          <Text style={styles.compReason}>{c.reason || c.geographicReasoning}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                )}

                {!isAddingManualComp ? (
                  <Pressable style={styles.addOutlineBtn} onPress={() => setIsAddingManualComp(true)}>
                    <Feather name="plus" size={14} color="#8B5CF6" />
                    <Text style={styles.addOutlineBtnText}>Add Competitor Manually</Text>
                  </Pressable>
                ) : (
                  <View style={styles.manualCompForm}>
                    <TextInput
                      style={styles.inputStandalone}
                      placeholder="Competitor Name (e.g. Songfinch)"
                      placeholderTextColor="#475569"
                      value={manualCompName}
                      onChangeText={setManualCompName}
                    />
                    <TextInput
                      style={[styles.inputStandalone, { marginTop: 8 }]}
                      placeholder="Website URL (e.g. songfinch.com)"
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

              {errorMessage ? (
                <View style={[styles.errorBox, { marginTop: 12, marginBottom: 4 }]}>
                  <Feather name="alert-circle" size={16} color="#EF4444" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              {isLoading ? (
                <View style={[styles.statusBox, { marginTop: 12, marginBottom: 4 }]}>
                  <ActivityIndicator size="small" color="#8B5CF6" />
                  <Text style={styles.statusText}>{statusMessage || 'Approving selected competitors...'}</Text>
                </View>
              ) : null}

              <View style={styles.btnRow}>
                <Pressable style={styles.secondaryBtn} onPress={() => setCurrentStep(4)}>
                  <Text style={styles.secondaryBtnText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, (!canProceed || isLoading) && { opacity: 0.5 }]}
                  onPress={handleApproveCompetitors}
                  disabled={!canProceed || isLoading}
                >
                  <Text style={styles.primaryBtnText}>
                    {isLoading
                      ? `Approving ${selectedCount}...`
                      : canProceed
                        ? effectiveVerdict === 'READY_WITH_LIMITED_EVIDENCE'
                          ? `Approve ${selectedCount} & Continue (With Caveats)`
                          : `Approve ${selectedCount} & Continue`
                        : 'Select At Least 1 Competitor'}
                  </Text>
                  <Feather name="arrow-right" size={16} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>
          );
        })()}

        {currentStep === 6 && (() => {
          const selectedCompetitors = candidateCompetitors.filter((c) => c.selected);
          const selectedCount = selectedCompetitors.length;
          const heroProductDisplay =
            customProductName ||
            (selectedProductId && productCatalogue.find((p) => p.id === selectedProductId)?.name) ||
            'Selected Offering';
          const isStrategyReady = selectedCount >= 1;

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
                      ? readinessState?.reason || 'Canonical Business Understanding and selected competitor baselines are ready.'
                      : 'Please select at least one relevant competitor in Step 5 before building your strategy.'}
                  </Text>
                </View>
              </View>

              {!isStrategyReady && (
                <View style={{ backgroundColor: '#1C1608', borderWidth: 1, borderColor: '#F59E0B', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#F59E0B', marginBottom: 4 }}>
                    ⚠️ No Competitors Selected
                  </Text>
                  <Text style={{ fontSize: 12, color: '#FDE68A', marginBottom: 10 }}>
                    Select at least one relevant competitor in Step 5 to proceed to Strategy Generation.
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
                  <Text style={styles.summaryValue}>{companyName || 'Your Business'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Selected Offering:</Text>
                  <Text style={styles.summaryValue}>{heroProductDisplay}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Industry & Model:</Text>
                  <Text style={styles.summaryValue}>{[industry, businessModel].filter(Boolean).join(' • ') || 'Specified'}</Text>
                </View>
                {(classificationProfile?.offeringAndDelivery?.value || classificationProfile?.offeringAndDelivery?.category) ? (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Delivery & Buyers:</Text>
                    <Text style={styles.summaryValue}>
                      {classificationProfile.offeringAndDelivery.value || classificationProfile.offeringAndDelivery.category} • {classificationProfile.buyerSegment?.value || classificationProfile.buyerSegment?.category || 'B2C'}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Target Market:</Text>
                  <Text style={styles.summaryValue}>{targetMarket}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Selected Competitors:</Text>
                  <Text style={[styles.summaryValue, !isStrategyReady && { color: '#F59E0B', fontWeight: '700' }]}>
                    {selectedCount} Approved ({readinessState?.verdict || 'READY'})
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
  badgeLocal: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  badgeCrossBorder: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  badgeInternational: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  cohortHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  cohortTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  cohortSubtitle: {
    fontSize: 11,
    color: '#64748B',
  },
  cohortCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  cohortCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
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