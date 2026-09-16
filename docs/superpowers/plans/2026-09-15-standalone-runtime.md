# Standalone Skill Runtime Implementation Plan

**Goal:** Install the blood-glucose-management directory without the App and run the same question-answering, reporting, planning, retrieval, simulation and confirmed device-tool workflow.

**Approved scope:** User confirmed standalone workflow parity. Preserve App working tree. No deployment, device writes, commits or pushes implied by implementation.

**Architecture:** Copy the current App workflow dependency closure and vendored LoopInsight kernel into the skill directory. Replace mobile configuration/storage/data-source boundaries with request-scoped Node adapters. Add JSON CLI, persistent sessions/confirmation journal and synthetic parity tests. Keep numerical policies unchanged; document boundary hardening separately.

**Tech stack:** Node >=22.13, TypeScript sources bundled with esbuild, axios, Node crypto/test runner and SQLite for action/session persistence.

## Steps

- [x] Add failing tests for standalone imports, deterministic workflows, time-scoped NS reads, replay-safe confirmations and simulation.
- [x] Extract sources into `skills/blood-glucose-management/runtime/src`, record hashes and source revision; preserve upstream licenses.
- [x] Implement request-local configuration, NS read adapter, relay journal, CLI and workflow wrapper. No network action without exact confirmation.
- [x] Produce synthetic baselines directly from App sources; compare states, search results, scenario trajectories and integrated plan metrics.
- [x] Package only the skill directory into a clean location; install, build, run tests and demo. Separately exercise real-model workflow in the standalone runtime.
- [x] Document installation, configuration, commands, confirmations, scope and deviations; check no credentials, patient fixtures or absolute local dependencies are packaged.

**Updated test authorization:** User subsequently explicitly requested testing against the real relay's previously confirmed isolated virtual pump. One model-selected `CARBS 2` command was sent after confirmation. Relay accepted it; terminal device audit reported failure. No other treatment commands were sent.

## Acceptance

`npm test` at repository root builds and tests the skill runtime. `node skills/blood-glucose-management/scripts/agent.mjs demo` runs synthetic current-state workflow including local simulation without App, Metro or a server. JSON `chat`, `tool`, `confirm`, `search`, `simulate`, `scenario` operations have stable results and actionable missing-configuration errors. Session confirmations survive process restart, are device-bound and never automatically replay uncertain POSTs. Configured real model planning/narration are distinguished from deterministic fallback.
