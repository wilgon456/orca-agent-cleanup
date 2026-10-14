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
// 에이전트 훅 설치 서비스가 늘거나 줄면 정리 대상 설정 파일도 달라진다.
const tree = await github('git/trees/main?recursive=1');
const hookServices = tree.tree
  .map((entry) => entry.path.match(/^src\/main\/([^/]+)\/hook-service\.ts$/)?.[1])
  .filter(Boolean)
  .sort();
const knownHookServices = new Set(baseline.hookServices || []);
const addedHookServices = hookServices.filter((name) => !knownHookServices.has(name));
const removedHookServices = [...knownHookServices].filter((name) => !hookServices.includes(name));
const latest = await github('releases/latest');
const result = {
  repository: baseline.repository,
  verifiedRelease: baseline.verifiedRelease,
  latestRelease: latest.tag_name,
  changed,
  addedHookServices,
  removedHookServices,
  treeTruncated: Boolean(tree.truncated),
};
console.log(JSON.stringify(result, null, 2));
if (changed.length > 0 || addedHookServices.length > 0 || removedHookServices.length > 0 || tree.truncated) {
  process.exitCode = 2;
}
