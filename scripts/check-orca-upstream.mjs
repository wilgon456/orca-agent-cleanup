#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';

const baseline = JSON.parse(fs.readFileSync(new URL('../.github/orca-upstream-baseline.json', import.meta.url), 'utf8'));
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'orca-agent-cleanup-upstream-check',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${baseline.repository}/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  return response.json();
}

const changed = [];
for (const [file, expectedSha] of Object.entries(baseline.files)) {
  const metadata = await github(`contents/${file}?ref=main`);
  if (metadata.sha !== expectedSha) changed.push({ file, expectedSha, currentSha: metadata.sha });
}
const latest = await github('releases/latest');
const result = {
  repository: baseline.repository,
  verifiedRelease: baseline.verifiedRelease,
  latestRelease: latest.tag_name,
  changed,
};
console.log(JSON.stringify(result, null, 2));
if (changed.length > 0) process.exitCode = 2;
