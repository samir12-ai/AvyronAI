import { useLanguage } from '@/context/LanguageContext';

export type TrustState =
  | 'validated'
  | 'provisional'
  | 'weak'
  | 'partial'
  | 'degraded'
  | 'lower_confidence'
  | 'data_refreshing'
  | 'unknown'
  | 'shadowed'
  | 'system_untrusted'
  | 'needs_reconciliation'
  | 'review_required'
  | 'blocked'
  | 'downgrade'
  | 'repair'
  | 'no_run'
  | 'ok';

export type TrustTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface TrustCopy {
  title: string;
  description: string;
  tone: TrustTone;
}

const STATE_TO_KEY: Record<TrustState, { title: string; desc: string; tone: TrustTone }> = {
  validated:            { title: 'trust.ok',                  desc: 'trust.okDesc',                  tone: 'success' },
  ok:                   { title: 'trust.ok',                  desc: 'trust.okDesc',                  tone: 'success' },
  provisional:          { title: 'trust.lowerConfidence',     desc: 'trust.lowerConfidenceDesc',     tone: 'warning' },
  weak:                 { title: 'trust.lowerConfidence',     desc: 'trust.lowerConfidenceDesc',     tone: 'warning' },
  partial:              { title: 'trust.partial',             desc: 'trust.partialDesc',             tone: 'warning' },
  degraded:             { title: 'trust.lowerConfidence',     desc: 'trust.lowerConfidenceDesc',     tone: 'warning' },
  lower_confidence:     { title: 'trust.lowerConfidence',     desc: 'trust.lowerConfidenceDesc',     tone: 'warning' },
  data_refreshing:      { title: 'trust.refreshing',          desc: 'trust.refreshingDesc',          tone: 'info'    },
  unknown:              { title: 'trust.checking',            desc: 'trust.checkingDesc',            tone: 'info'    },
  shadowed:             { title: 'trust.newerFailed',         desc: 'trust.newerFailedDesc',         tone: 'warning' },
  system_untrusted:     { title: 'trust.awaitingVerification',desc: 'trust.awaitingVerificationDesc',tone: 'warning' },
  needs_reconciliation: { title: 'trust.reviewNeeded',        desc: 'trust.reviewNeededDesc',        tone: 'warning' },
  review_required:      { title: 'trust.reviewNeeded',        desc: 'trust.reviewNeededDesc',        tone: 'warning' },
  blocked:              { title: 'trust.paused',              desc: 'trust.pausedDesc',              tone: 'error'   },
  downgrade:            { title: 'trust.runningCarefully',    desc: 'trust.runningCarefullyDesc',    tone: 'warning' },
  repair:               { title: 'trust.repairing',           desc: 'trust.repairingDesc',           tone: 'info'    },
  no_run:               { title: 'trust.noRun',               desc: 'trust.noRunDesc',               tone: 'neutral' },
};

const TONE_TO_COLOR: Record<TrustTone, string> = {
  success: '#10B981',
  warning: '#F59E0B',
  error:   '#EF4444',
  info:    '#4C9AFF',
  neutral: '#8892A4',
};

export function trustToneColor(tone: TrustTone): string {
  return TONE_TO_COLOR[tone];
}

export function useTrustCopy() {
  const { t } = useLanguage();
  return (state: TrustState, overrides?: { description?: string }): TrustCopy => {
    const m = STATE_TO_KEY[state] ?? STATE_TO_KEY.unknown;
    return {
      title: t(m.title),
      description: overrides?.description ?? t(m.desc),
      tone: m.tone,
    };
  };
}

export function mapProvenanceState(kind: string): TrustState {
  switch (kind) {
    case 'verified':   return 'validated';
    case 'projected':  return 'lower_confidence';
    case 'benchmark':  return 'lower_confidence';
    case 'manual':     return 'unknown';
    case 'unverified': return 'system_untrusted';
    default:           return 'unknown';
  }
}
