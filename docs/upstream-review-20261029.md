# Orca source review: Jira skills and provider roots

The prior contract baseline is Orca v1.4.224 at
`5e1c117a86de383c97bf42e5df51c167bed385a1`. This review compared the
skill manifest and skill placement sources with Orca v1.4.243 at
`2d9b5957851e5bd449e179018e53759ea69e3f0b` on 2026-10-29.

- The reviewed manifest adds `jira-tickets` and `orca-jira` to the eight
  previously listed skills. Both contain the existing `ORCA skills get`
  ownership signature. Names alone still do not authorize quarantine.
- The v1.4.243 provider list adds CodeBuddy, Kiro and OpenClaude home and
  workspace skill paths. Kiro and OpenClaude also support the respective
  `KIRO_HOME` and `OPENCLAUDE_CONFIG_DIR` overrides.
- Tests use temporary fixtures to cover signed and lock-proven Jira skills,
  unsigned same-name skills, provider homes and selected projects, plugin
  caches, dry-run, backup verification and restoration. The legacy Windows
  PowerShell smoke test also checks a signed Jira skill and an unrelated
  same-name skill.

Sources: [v1.4.243 manifest](https://github.com/stablyai/orca/blob/2d9b5957851e5bd449e179018e53759ea69e3f0b/resources/skills/current-manifest.json),
[provider locations](https://github.com/stablyai/orca/blob/2d9b5957851e5bd449e179018e53759ea69e3f0b/src/shared/skill-install-providers.ts),
[Jira skill](https://github.com/stablyai/orca/blob/2d9b5957851e5bd449e179018e53759ea69e3f0b/skills/jira-tickets/SKILL.md).

This is not a full compatibility review of Orca v1.4.243. Other monitored
upstream files changed, including hook schemas, installer paths and temporary
skill-transaction names. In particular, `.orca-stage-` and `.orca-old-`
siblings need an ownership and recovery review before they can be added to
cleanup. The older baseline remains unchanged so the upstream comparison does
not silently report a full review. The scheduled comparison workflow was
manually disabled in GitHub at the time of this review; this change does not
alter that setting.
