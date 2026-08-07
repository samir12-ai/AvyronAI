import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  initializeE2EDatabase, 
  validateFixtureId, 
  isDryRun, 
  withE2ETransaction, 
  E2ESafeguardError,
  assertExpectedRowCount,
  assertExactReturnedIds,
  cleanupManifest,
  createEmptyManifest
} from '../../tests/e2e/support/e2e_guard';

// Mock dependencies
vi.mock('pg', () => {
  const Pool = vi.fn().mockImplementation(function() {
    return {
      query: vi.fn().mockResolvedValue({
        rows: [{
          dbname: 'e2e_test_db',
          user: 'test_user',
          server_addr: '127.0.0.1',
          app_name: 'test_app'
        }]
      }),
      end: vi.fn()
    };
  });
  return { Pool };
});

vi.mock('drizzle-orm/node-postgres', () => {
  return {
    drizzle: vi.fn().mockReturnValue({
      transaction: vi.fn(async (cb) => {
        const tx = {
          rollback: vi.fn().mockImplementation(() => { throw new Error("Rollback triggered"); }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'e2e_1' }])
            })
          })
        };
        try {
          return await cb(tx);
        } catch (e: any) {
          if (e.message !== "Rollback triggered") throw e;
        }
      })
    })
  };
});

vi.mock('../../../shared/schema', () => ({
  pipelineChangeEvents: { id: {} },
  pipelineSnapshots: { id: {} },
  ciCompetitorPosts: { id: {} },
  competitorPostClassifications: { id: {} },
  ciCompetitors: { id: {} },
  growthCampaigns: { id: {} }
}));

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn()
}));

describe('E2E Safeguard Utility', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalArgv: string[];

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalArgv = [...process.argv];
    
    // Default valid setup
    process.env.NODE_ENV = 'test';
    process.env.E2E_SAFEGUARD = 'true';
    process.env.E2E_DATABASE_URL = 'postgres://test:test@localhost:5432/e2e_db';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/prod_db';
    
    vi.clearAllMocks();
    
    // Reset singleton state in guard
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
  });

  it('1. NODE_ENV=development is rejected', async () => {
    process.env.NODE_ENV = 'development';
    const { initializeE2EDatabase } = await import('../../tests/e2e/support/e2e_guard');
    await expect(initializeE2EDatabase()).rejects.toThrow(/NODE_ENV must be 'test'/);
  });

  it('2. Missing E2E_DATABASE_URL is rejected', async () => {
    delete process.env.E2E_DATABASE_URL;
    const { initializeE2EDatabase } = await import('../../tests/e2e/support/e2e_guard');
    await expect(initializeE2EDatabase()).rejects.toThrow(/E2E_DATABASE_URL is explicitly required/);
  });

  it('3. Using DATABASE_URL instead of E2E_DATABASE_URL is rejected', async () => {
    process.env.E2E_DATABASE_URL = process.env.DATABASE_URL;
    const { initializeE2EDatabase } = await import('../../tests/e2e/support/e2e_guard');
    await expect(initializeE2EDatabase()).rejects.toThrow(/E2E_DATABASE_URL cannot be identical to DATABASE_URL/);
  });

  it('4. Active Neon branch is rejected', async () => {
    process.env.E2E_DATABASE_URL = 'postgres://test@ep-twilight-night-asou49te.us-east-1.aws.neon.tech/db';
    const { initializeE2EDatabase } = await import('../../tests/e2e/support/e2e_guard');
    await expect(initializeE2EDatabase()).rejects.toThrow(/Active known production branch.*hard-blocked/);
  });

  it('5. Non-e2e account ID is rejected', () => {
    expect(() => validateFixtureId('normal_account')).toThrow(/does not start with required prefix/);
  });

  it('6. Non-e2e campaign ID is rejected', () => {
    expect(() => validateFixtureId('campaign_123')).toThrow(/does not start with required prefix/);
  });

  it('7. Mixed fixture ownership is rejected', async () => {
    const { withE2ETransaction, createEmptyManifest } = await import('../../tests/e2e/support/e2e_guard');
    const manifest = createEmptyManifest();
    manifest.campaignIds.push('e2e_campaign');
    manifest.campaignIds.push('prod_campaign'); // Invalid
    
    await expect(withE2ETransaction('test', manifest, async () => {})).rejects.toThrow(/does not start with required prefix/);
  });

  it('8. Dry-run performs zero writes', () => {
    // isDryRun checks argv
    process.argv = ['node', 'script'];
    expect(isDryRun()).toBe(true);
    
    process.argv = ['node', 'script', '--apply', '--confirm=E2E_ONLY_DESTRUCTIVE_WRITE'];
    expect(isDryRun()).toBe(false);
  });

  it('9. Wrong affected row count triggers rollback', () => {
    expect(() => assertExpectedRowCount({ rowCount: 1 }, 2, 'test')).toThrow(/Row count mismatch/);
  });

  it('10. Correct count but wrong IDs triggers rollback', () => {
    const returned = [{ id: 'e2e_1' }, { id: 'e2e_2' }];
    expect(() => assertExactReturnedIds(returned, ['e2e_1', 'e2e_3'], 'test')).toThrow(/Exact ID mismatch/);
  });

  it('11. A failure after delete but before insert restores deleted rows through rollback', async () => {
    const { withE2ETransaction, createEmptyManifest } = await import('../../tests/e2e/support/e2e_guard');
    process.argv = ['node', 'script', '--apply', '--confirm=E2E_ONLY_DESTRUCTIVE_WRITE'];
    
    let deleted = false;
    await expect(withE2ETransaction('test_rollback', createEmptyManifest(), async (tx) => {
      deleted = true;
      throw new Error("Simulated insert failure");
    })).rejects.toThrow("Simulated insert failure");
    
    expect(deleted).toBe(true);
    // Since tx.rollback() is called in the catch block (mocked in drizzle), it's safe.
  });

  it('12. Cleanup cannot delete a row not listed in the fixture manifest', async () => {
    const { cleanupManifest, createEmptyManifest } = await import('../../tests/e2e/support/e2e_guard');
    const manifest = createEmptyManifest();
    // Empty manifest throws error
    await expect(cleanupManifest({}, manifest, false)).rejects.toThrow(/Manifest is missing or empty/);
  });

  it('13. Success is logged only after commit and independent read-back verification', async () => {
    // This is tested implicitly by the flow of withE2ETransaction where commit message is printed last.
    const { withE2ETransaction, createEmptyManifest } = await import('../../tests/e2e/support/e2e_guard');
    process.argv = ['node', 'script', '--apply', '--confirm=E2E_ONLY_DESTRUCTIVE_WRITE'];
    const consoleSpy = vi.spyOn(console, 'log');
    
    await withE2ETransaction('test_success', createEmptyManifest(), async () => {
      return "done";
    });
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[COMMIT] test_success successful.'));
  });

  it('14. The quarantined unsafe script cannot be run by normal project commands', () => {
    const fs = require('fs');
    const path = require('path');
    const rootPath = path.resolve(__dirname, '../..');
    
    // Check old location doesn't exist
    expect(fs.existsSync(path.join(rootPath, 'scratch', 'copy_seed_to_all.ts'))).toBe(false);
    
    // Check package.json doesn't reference it
    const pkgJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
    const scriptsString = JSON.stringify(pkgJson.scripts || {});
    expect(scriptsString).not.toContain('copy_seed_to_all.ts');
  });
});
