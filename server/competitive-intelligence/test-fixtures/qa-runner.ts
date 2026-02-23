import fs from 'fs';
import path from 'path';

const FIXTURES_DIR = path.join(__dirname);

interface QAResult {
  scenario: string;
  assertions: { check: string; passed: boolean; detail?: string }[];
  passed: boolean;
}

function runScenario1(): QAResult {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'scenario-1-cta-in-pinned-comment.json'), 'utf-8')
  );
  const ep = fixture.expectedEvidencePack;
  const interp = fixture.expectedInterpretation;
  const assertions: { check: string; passed: boolean; detail?: string }[] = [];

  assertions.push({
    check: 'pinnedCommentText is non-null and contains DM us',
    passed: ep.pinnedCommentText !== null && ep.pinnedCommentText.includes('DM us'),
  });

  assertions.push({
    check: 'ctaSignals includes at least one from pinned_comment source',
    passed: interp.ctaSignals.some((s: any) => s.source === 'pinned_comment'),
  });

  assertions.push({
    check: 'deterministicSignals.ctaKeywords includes DM us',
    passed: ep.deterministicSignals.ctaKeywords.includes('DM us'),
  });

  const json = JSON.stringify(fixture);
  assertions.push({
    check: 'No ESTIMATED labels appear anywhere in output',
    passed: !json.includes('"ESTIMATED"') && !json.includes('"estimated"'),
  });

  assertions.push({
    check: 'All signals have source attribution',
    passed: [...interp.hookCandidates, ...interp.ctaSignals, ...interp.offerSignals].every(
      (s: any) => s.source && s.source.length > 0
    ),
  });

  assertions.push({
    check: 'confidenceBreakdown has structured fields (ocr_confidence, transcript_confidence, rule_confidence, overall_data_quality)',
    passed:
      ep.confidenceBreakdown &&
      typeof ep.confidenceBreakdown.ocr_confidence === 'number' &&
      typeof ep.confidenceBreakdown.transcript_confidence === 'number' &&
      typeof ep.confidenceBreakdown.rule_confidence === 'number' &&
      typeof ep.confidenceBreakdown.overall_data_quality === 'number',
  });

  assertions.push({
    check: 'asset_ttl_hours is 24',
    passed: ep.asset_ttl_hours === 24,
  });

  assertions.push({
    check: 'purge_scheduled_at is a valid timestamp',
    passed: typeof ep.purge_scheduled_at === 'string' && ep.purge_scheduled_at.length > 0,
  });

  return {
    scenario: fixture.scenario,
    assertions,
    passed: assertions.every(a => a.passed),
  };
}

function runScenario2(): QAResult {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'scenario-2-cta-in-overlay.json'), 'utf-8')
  );
  const ep = fixture.expectedEvidencePack;
  const interp = fixture.expectedInterpretation;
  const assertions: { check: string; passed: boolean; detail?: string }[] = [];

  assertions.push({
    check: 'pinnedCommentText is null',
    passed: ep.pinnedCommentText === null,
  });

  assertions.push({
    check: 'warnings includes PINNED_COMMENT_UNAVAILABLE',
    passed: ep.warnings.some((w: any) => w.code === 'PINNED_COMMENT_UNAVAILABLE'),
  });

  assertions.push({
    check: 'ctaSignals includes at least one from ocr source',
    passed: interp.ctaSignals.some((s: any) => s.source === 'ocr'),
  });

  assertions.push({
    check: 'offerSignals includes FREE TRIAL from ocr',
    passed: interp.offerSignals.some(
      (s: any) => s.source === 'ocr' && s.text.includes('FREE TRIAL')
    ),
  });

  assertions.push({
    check: 'unavailable includes pinned_comment_cta with reason',
    passed: interp.unavailable.some(
      (u: any) => u.signal === 'pinned_comment_cta' && u.reason.length > 0
    ),
  });

  const json = JSON.stringify(fixture);
  assertions.push({
    check: 'No ESTIMATED labels appear anywhere in output',
    passed: !json.includes('"ESTIMATED"') && !json.includes('"estimated"'),
  });

  assertions.push({
    check: 'confidenceBreakdown has structured fields (ocr_confidence, transcript_confidence, rule_confidence, overall_data_quality)',
    passed:
      ep.confidenceBreakdown &&
      typeof ep.confidenceBreakdown.ocr_confidence === 'number' &&
      typeof ep.confidenceBreakdown.transcript_confidence === 'number' &&
      typeof ep.confidenceBreakdown.rule_confidence === 'number' &&
      typeof ep.confidenceBreakdown.overall_data_quality === 'number',
  });

  assertions.push({
    check: 'asset_ttl_hours is 24',
    passed: ep.asset_ttl_hours === 24,
  });

  assertions.push({
    check: 'purge_scheduled_at is a valid timestamp',
    passed: typeof ep.purge_scheduled_at === 'string' && ep.purge_scheduled_at.length > 0,
  });

  return {
    scenario: fixture.scenario,
    assertions,
    passed: assertions.every(a => a.passed),
  };
}

function runScenario3(): QAResult {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'scenario-3-video-download-failure.json'), 'utf-8')
  );
  const ep = fixture.expectedEvidencePack;
  const interp = fixture.expectedInterpretation;
  const assertions: { check: string; passed: boolean; detail?: string }[] = [];

  assertions.push({
    check: 'status is PARTIAL, not COMPLETE',
    passed: ep.status === 'PARTIAL',
  });

  assertions.push({
    check: 'warnings include VIDEO_DOWNLOAD_FAILED and AUDIO_UNAVAILABLE',
    passed:
      ep.warnings.some((w: any) => w.code === 'VIDEO_DOWNLOAD_FAILED') &&
      ep.warnings.some((w: any) => w.code === 'AUDIO_UNAVAILABLE'),
  });

  assertions.push({
    check: 'transcript is null',
    passed: ep.transcript === null,
  });

  assertions.push({
    check: 'transcriptConfidence is null',
    passed: ep.transcriptConfidence === null,
  });

  assertions.push({
    check: 'CTA still detected from OCR and pinned_comment despite video failure',
    passed:
      interp.ctaSignals.some((s: any) => s.source === 'ocr') &&
      interp.ctaSignals.some((s: any) => s.source === 'pinned_comment'),
  });

  assertions.push({
    check: 'unavailable includes hook_analysis with specific reason',
    passed: interp.unavailable.some(
      (u: any) => u.signal === 'hook_analysis' && u.reason.length > 0
    ),
  });

  const json = JSON.stringify(fixture);
  assertions.push({
    check: 'No ESTIMATED labels appear anywhere in output',
    passed: !json.includes('"ESTIMATED"') && !json.includes('"estimated"'),
  });

  assertions.push({
    check: 'sourcesSucceeded does NOT include video_frames or audio_transcript',
    passed:
      !ep.sourcesSucceeded.includes('video_frames') &&
      !ep.sourcesSucceeded.includes('audio_transcript'),
  });

  assertions.push({
    check: 'confidenceBreakdown has structured fields (ocr_confidence, transcript_confidence, rule_confidence, overall_data_quality)',
    passed:
      ep.confidenceBreakdown &&
      typeof ep.confidenceBreakdown.ocr_confidence === 'number' &&
      ep.confidenceBreakdown.transcript_confidence === null &&
      typeof ep.confidenceBreakdown.rule_confidence === 'number' &&
      typeof ep.confidenceBreakdown.overall_data_quality === 'number',
  });

  assertions.push({
    check: 'asset_ttl_hours is 24',
    passed: ep.asset_ttl_hours === 24,
  });

  assertions.push({
    check: 'purge_scheduled_at is a valid timestamp',
    passed: typeof ep.purge_scheduled_at === 'string' && ep.purge_scheduled_at.length > 0,
  });

  assertions.push({
    check: 'transcript_confidence is null in confidenceBreakdown',
    passed: ep.confidenceBreakdown.transcript_confidence === null,
  });

  return {
    scenario: fixture.scenario,
    assertions,
    passed: assertions.every(a => a.passed),
  };
}

function main() {
  console.log('=== Creative Capture QA Runner ===\n');

  const results = [runScenario1(), runScenario2(), runScenario3()];
  let allPassed = true;

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} Scenario: ${result.scenario}`);
    for (const a of result.assertions) {
      const ai = a.passed ? '  ✓' : '  ✗';
      console.log(`${ai} ${a.check}`);
    }
    console.log('');
    if (!result.passed) allPassed = false;
  }

  console.log(allPassed ? '=== ALL SCENARIOS PASSED ===' : '=== SOME SCENARIOS FAILED ===');
  process.exit(allPassed ? 0 : 1);
}

main();
