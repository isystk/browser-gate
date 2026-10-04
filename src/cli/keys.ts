import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  addApiKey,
  grantProfiles,
  listApiKeys,
  revokeApiKey,
} from '../auth/keyAdmin.js';
import { type AppConfig, loadConfigFile } from '../config/appConfig.js';

const USAGE = `Usage:
  npm run keys -- add --id <id> [--profile <name>]...   Issue a key (the plaintext is printed once)
  npm run keys -- grant --id <id> --profile <name>...   Let an existing key use more profiles
  npm run keys -- list                                  List keys
  npm run keys -- revoke --id <id>                      Revoke a key
Environment: CONFIG_PATH (default config/local.json)`;

const CONFIG_PATH = process.env.CONFIG_PATH ?? 'config/local.json';

/** 設定ファイルの APIキーを発行・一覧・失効する運用CLI。 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      profile: { type: 'string', multiple: true },
    },
  });
  const [command] = positionals;
  const config = await loadConfigFile(CONFIG_PATH);
  if (command === 'list') return printKeys(config);
  if (command === 'add' && values.id !== undefined)
    return issueKey(config, values.id, values.profile ?? []);
  if (
    command === 'grant' &&
    values.id !== undefined &&
    (values.profile ?? []).length > 0
  )
    return grantKey(config, values.id, values.profile ?? []);
  if (command === 'revoke' && values.id !== undefined)
    return revokeKey(config, values.id);
  console.error(USAGE);
  process.exitCode = 1;
}

function printKeys(config: AppConfig): void {
  console.table(listApiKeys(config));
}

async function issueKey(
  config: AppConfig,
  id: string,
  profiles: string[],
): Promise<void> {
  const { config: next, key } = addApiKey(config, { id, profiles }, new Date());
  await saveConfig(next);
  console.log(
    `Issued API key for "${id}". It is shown only once; store it outside Git:`,
  );
  console.log(key);
}

async function grantKey(
  config: AppConfig,
  id: string,
  profiles: string[],
): Promise<void> {
  await saveConfig(grantProfiles(config, id, profiles));
  console.log(`Granted ${profiles.join(', ')} to API key "${id}".`);
}

async function revokeKey(config: AppConfig, id: string): Promise<void> {
  await saveConfig(revokeApiKey(config, id, new Date()));
  console.log(`Revoked API key "${id}".`);
}

async function saveConfig(config: AppConfig): Promise<void> {
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
