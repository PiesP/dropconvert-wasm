import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'licenses');

type UnknownRecord = Record<string, unknown>;

function sortObjectKeys<T extends UnknownRecord>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'en')),
  ) as T;
}

function sanitizeLicensesByKey(raw: unknown): UnknownRecord {
  const byLicense: UnknownRecord = {};

  if (!raw || typeof raw !== 'object') return byLicense;

  for (const [license, entries] of Object.entries(raw as UnknownRecord)) {
    if (!Array.isArray(entries)) continue;

    const next = (entries as unknown[])
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;

        // pnpm returns absolute filesystem paths. Never publish those.
        // Keep the rest of the metadata to provide attribution.
        const { paths: _paths, ...rest } = entry as UnknownRecord & {
          paths?: unknown;
          versions?: unknown;
        };

        if (Array.isArray(rest.versions)) {
          rest.versions = [...rest.versions].sort((a, b) =>
            String(a).localeCompare(String(b), 'en'),
          );
        }

        return rest;
      })
      .sort((a, b) => {
        const an = typeof (a as { name?: unknown } | undefined)?.name === 'string' ? (a as any).name : '';
        const bn = typeof (b as { name?: unknown } | undefined)?.name === 'string' ? (b as any).name : '';
        return an.localeCompare(bn, 'en');
      });

    byLicense[license] = next;
  }

  return sortObjectKeys(byLicense);
}

async function runPnpmLicenses(scopeFlag: '--prod' | '--dev' | null) {
  const args = ['-s', 'licenses', 'list', '--json'];
  if (scopeFlag) args.push(scopeFlag);

  const { stdout } = await execFileAsync('pnpm', args, {
    cwd: rootDir,
    // Some projects have large dependency trees; keep buffer generous.
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });

  return JSON.parse(stdout) as unknown;
}

async function writeReport(opts: {
  filename: string;
  scope: 'prod' | 'dev' | 'all';
  raw: unknown;
}) {
  const payload = {
    schema: 'https://example.com/schemas/third-party-licenses.v1.json',
    generatedAt: new Date().toISOString(),
    scope: opts.scope,
    tool: 'pnpm licenses list --json',
    packagesByLicense: sanitizeLicensesByKey(opts.raw),
  };

  const outPath = path.join(outDir, opts.filename);
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const [prod, dev, all] = await Promise.all([
    runPnpmLicenses('--prod'),
    runPnpmLicenses('--dev'),
    runPnpmLicenses(null),
  ]);

  await writeReport({
    filename: 'third-party-licenses.prod.json',
    scope: 'prod',
    raw: prod,
  });

  await writeReport({
    filename: 'third-party-licenses.dev.json',
    scope: 'dev',
    raw: dev,
  });

  await writeReport({
    filename: 'third-party-licenses.all.json',
    scope: 'all',
    raw: all,
  });
}

main().catch((err) => {
  console.error('Failed to generate third-party licenses:', err);
  process.exitCode = 1;
});
