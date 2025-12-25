import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'licenses');

function sortObjectKeys(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'en'))
  );
}

function sanitizeLicensesByKey(raw) {
  const byLicense = {};

  for (const [license, entries] of Object.entries(raw)) {
    if (!Array.isArray(entries)) continue;

    const next = entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;

        // pnpm returns absolute filesystem paths. Never publish those.
        // Keep the rest of the metadata to provide attribution.
        const { paths: _paths, ...rest } = entry;

        if (Array.isArray(rest.versions)) {
          rest.versions = [...rest.versions].sort((a, b) => a.localeCompare(b, 'en'));
        }

        return rest;
      })
      .sort((a, b) => {
        const an = typeof a?.name === 'string' ? a.name : '';
        const bn = typeof b?.name === 'string' ? b.name : '';
        return an.localeCompare(bn, 'en');
      });

    byLicense[license] = next;
  }

  return sortObjectKeys(byLicense);
}

async function runPnpmLicenses(scopeFlag) {
  const args = ['-s', 'licenses', 'list', '--json'];
  if (scopeFlag) args.push(scopeFlag);

  const { stdout } = await execFileAsync('pnpm', args, {
    cwd: rootDir,
    // Some projects have large dependency trees; keep buffer generous.
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });

  return JSON.parse(stdout);
}

async function writeReport({ filename, scope, raw }) {
  const payload = {
    schema: 'https://example.com/schemas/third-party-licenses.v1.json',
    generatedAt: new Date().toISOString(),
    scope,
    tool: 'pnpm licenses list --json',
    packagesByLicense: sanitizeLicensesByKey(raw),
  };

  const outPath = path.join(outDir, filename);
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
  // eslint-disable-next-line no-console
  console.error('Failed to generate third-party licenses:', err);
  process.exitCode = 1;
});
