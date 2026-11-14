import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadConfig, loadDotEnv, resolvePaths, writeConfig } from '../../src/config.js';

describe('config', () => {
  it('首次加载自动创建 config（600）与 apiToken', () => {
    const home = mkdtempSync(join(tmpdir(), 'fuma-cfg-'));
    const { config, paths } = loadConfig({ home });
    expect(config.server.apiToken.length).toBeGreaterThan(16);
    expect(config.upstream.companyId).toBe(10264);
    expect(config.rules.capacityPerAccount).toBe(500);
    expect(paths.home).toBe(home);
    const st = statSync(paths.configFile);
    expect(st.mode & 0o777).toBe(0o600);
    const raw = JSON.parse(readFileSync(paths.configFile, 'utf8'));
    expect(raw.upstream.baseUrl).toBe('https://www.fumamx.com');
  });

  it('二次加载保持同一 apiToken，并可写回', () => {
    const home = mkdtempSync(join(tmpdir(), 'fuma-cfg-'));
    const first = loadConfig({ home });
    first.config.accounts.push({
      accountId: 'acct_01', name: 'A', ownerName: '', loginMode: 'dingtalk_sso_qr',
      dingtalkOrg: '上海孚盟软件有限公司', fumaEnterprise: '上海孚盟软件有限公司', keepBrowserAlive: false, enabled: true
    });
    writeConfig(first.paths, first.config);
    const second = loadConfig({ home });
    expect(second.config.server.apiToken).toBe(first.config.server.apiToken);
    expect(second.config.accounts[0]?.accountId).toBe('acct_01');
  });

  it('resolvePaths 默认路径正确', () => {
    const p = resolvePaths('/tmp/x');
    expect(p.configFile).toBe('/tmp/x/config.json');
    expect(p.dbFile).toBe('/tmp/x/data/fuma.db');
    expect(p.secretKeyFile).toBe('/tmp/x/secret.key');
  });

  it('loadDotEnv 解析键值且忽略注释', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuma-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, '# comment\nFUMA_TEST_KEY=abc\nQUOTED="x y"\n');
    const env = loadDotEnv(file);
    expect(env.FUMA_TEST_KEY).toBe('abc');
    expect(env.QUOTED).toBe('x y');
  });

  it('defaultConfig 满足 schema', () => {
    const paths = resolvePaths('/tmp/y');
    const cfg = defaultConfig(paths);
    expect(cfg.paths.dbFile).toBe('/tmp/y/data/fuma.db');
  });
});
