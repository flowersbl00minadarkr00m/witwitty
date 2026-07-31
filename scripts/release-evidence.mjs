#!/usr/bin/env node

/**
 * Creates and verifies immutable release-evidence manifests without runtime
 * dependencies. Run from app/: pnpm run evidence:build
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const APP_ROOT = process.cwd();
const EVIDENCE_ROOT = resolve("evidence/release-stabilization");
const BUILD_MANIFEST_PATH = join(EVIDENCE_ROOT, "build-manifest.json");
const REQUIRED_RELEASE_FILES = [
  "dist/manifest.json",
  "dist/background.js",
  "dist/content.js",
  "dist/panel.html",
];
const REQUIRED_COMMANDS = [
  ["test", "pnpm test"],
  ["typecheck", "pnpm typecheck"],
  ["build", "pnpm build"],
];
const FINGERPRINT_INPUTS = [
  "src",
  "public",
  "panel.html",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "scripts/build-extension.mjs",
  "scripts/release-evidence.mjs",
  "evidence/release-stabilization/README.md",
  "evidence/release-stabilization/schema",
];

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function relativePath(filePath) {
  return relative(APP_ROOT, filePath).replaceAll("\\", "/");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectFiles(rootPath) {
  const entry = lstatSync(rootPath);
  if (entry.isSymbolicLink()) {
    fail(`Refusing symbolic link in release evidence input: ${relativePath(rootPath)}`);
  }
  if (entry.isFile()) return [rootPath];
  if (!entry.isDirectory()) fail(`Unsupported release evidence input: ${relativePath(rootPath)}`);

  const files = [];
  for (const child of readdirSync(rootPath, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
    files.push(...collectFiles(join(rootPath, child.name)));
  }
  return files;
}

function collectRelativeFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const path = resolve(input);
    try {
      files.push(...collectFiles(path));
    } catch (error) {
      fail(`Cannot collect required evidence input ${input}: ${error.message}`);
    }
  }
  return [...new Set(files.map(relativePath))].sort(comparePaths);
}

function computeSourceFingerprint() {
  const files = collectRelativeFiles(FINGERPRINT_INPUTS);
  const hashes = files.map((file) => ({ file, sha256: sha256File(resolve(file)) }));
  const canonicalInput = hashes.map(({ file, sha256: digest }) => `${file}\0${digest}\n`).join("");
  return {
    files_included: hashes.map(({ file }) => file),
    fingerprint_method: "sha256-sorted-file-hashes",
    fingerprint_value: sha256(canonicalInput),
  };
}

function computeReleaseFiles() {
  for (const file of REQUIRED_RELEASE_FILES) {
    try {
      if (!lstatSync(resolve(file)).isFile()) fail(`not a file: ${file}`);
    } catch (error) {
      fail(`Required release file missing or unreadable: ${file} (${error.message})`);
    }
  }

  const releaseFiles = collectRelativeFiles(["dist"]).map((path) => ({ path, sha256: sha256File(resolve(path)) }));
  const byPath = new Map(releaseFiles.map((entry) => [entry.path, entry.sha256]));
  return {
    files: {
      manifest_json: byPath.get("dist/manifest.json"),
      background_js: byPath.get("dist/background.js"),
      content_js: byPath.get("dist/content.js"),
      panel_html: byPath.get("dist/panel.html"),
    },
    release_files: releaseFiles,
  };
}

function summary(value) {
  const text = value.trim();
  return text.length > 500 ? text.slice(0, 500) : text;
}

function runCommand(command) {
  const executed_utc = new Date().toISOString();
  console.log(`Running: ${command}`);
  try {
    const stdout = execSync(command, { cwd: APP_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { command, exit_code: 0, status: "pass", executed_utc, ...(summary(stdout) ? { stdout_summary: summary(stdout) } : {}) };
  } catch (error) {
    const exitCode = Number.isInteger(error.status) ? error.status : 1;
    const stdout = summary(String(error.stdout ?? ""));
    const stderr = summary(String(error.stderr ?? error.message ?? ""));
    fail(`Required command failed and no passing result was emitted: ${command} (exit ${exitCode})${stderr ? `: ${stderr}` : ""}${stdout ? `; stdout: ${stdout}` : ""}`);
  }
}

function packageVersion(packageName) {
  try {
    return JSON.parse(readFileSync(resolve("node_modules", packageName, "package.json"), "utf8")).version;
  } catch (error) {
    fail(`Cannot read installed ${packageName} version: ${error.message}`);
  }
}

function commandVersion(command) {
  try {
    return execSync(command, { cwd: APP_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    fail(`Cannot obtain version from ${command}: ${error.message}`);
  }
}

function validationError(path, message) {
  fail(`Schema validation failed at ${path}: ${message}`);
}

function object(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) validationError(path, "must be an object");
}

function required(value, key, path) {
  if (!(key in value)) validationError(path, `missing required property ${key}`);
  return value[key];
}

function string(value, path, pattern) {
  if (typeof value !== "string") validationError(path, "must be a string");
  if (pattern && !pattern.test(value)) validationError(path, "has an invalid format");
}

function nonEmptyString(value, path, pattern) {
  string(value, path, pattern);
  if (!value.trim()) validationError(path, "must not be empty");
}

function isoDate(value, path) {
  string(value, path, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (Number.isNaN(Date.parse(value))) validationError(path, "must be an ISO 8601 date-time");
}

function sha(value, path) {
  string(value, path, /^[a-f0-9]{64}$/);
}

function commandResult(value, path) {
  object(value, path);
  string(required(value, "command", path), `${path}.command`);
  if (required(value, "exit_code", path) !== 0) validationError(`${path}.exit_code`, "must be 0 for a passing required command");
  if (required(value, "status", path) !== "pass") validationError(`${path}.status`, "must be pass");
  isoDate(required(value, "executed_utc", path), `${path}.executed_utc`);
  for (const key of ["stdout_summary", "stderr_summary"]) if (key in value) string(value[key], `${path}.${key}`);
}

function validateBuildManifest(data) {
  object(data, "$build");
  string(required(data, "candidate_id", "$build"), "$.candidate_id", /^[a-z0-9-]+$/);
  isoDate(required(data, "created_utc", "$build"), "$.created_utc");
  for (const key of ["app_version", "node_version", "pnpm_version", "typescript_version", "vite_version", "esbuild_version"]) string(required(data, key, "$build"), `$.${key}`);

  const fingerprint = required(data, "source_fingerprint", "$build");
  object(fingerprint, "$.source_fingerprint");
  const included = required(fingerprint, "files_included", "$.source_fingerprint");
  if (!Array.isArray(included) || included.length === 0) validationError("$.source_fingerprint.files_included", "must be a non-empty array");
  for (const [index, file] of included.entries()) string(file, `$.source_fingerprint.files_included[${index}]`);
  if (fingerprint.fingerprint_method !== "sha256-sorted-file-hashes") validationError("$.source_fingerprint.fingerprint_method", "must be sha256-sorted-file-hashes");
  sha(required(fingerprint, "fingerprint_value", "$.source_fingerprint"), "$.source_fingerprint.fingerprint_value");

  const files = required(data, "files", "$build");
  object(files, "$.files");
  for (const key of ["manifest_json", "background_js", "content_js", "panel_html"]) sha(required(files, key, "$.files"), `$.files.${key}`);

  const releaseFiles = required(data, "release_files", "$build");
  if (!Array.isArray(releaseFiles) || releaseFiles.length === 0) validationError("$.release_files", "must be a non-empty array");
  let previousPath = "";
  for (const [index, entry] of releaseFiles.entries()) {
    object(entry, `$.release_files[${index}]`);
    const path = required(entry, "path", `$.release_files[${index}]`);
    string(path, `$.release_files[${index}].path`, /^dist\/.+/);
    if (path <= previousPath) validationError("$.release_files", "must be strictly sorted by path without duplicates");
    previousPath = path;
    sha(required(entry, "sha256", `$.release_files[${index}]`), `$.release_files[${index}].sha256`);
  }

  const commands = required(data, "commands", "$build");
  object(commands, "$.commands");
  for (const key of ["test", "typecheck", "build"]) commandResult(required(commands, key, "$.commands"), `$.commands.${key}`);
}

function validateEnvironment(data) {
  object(data, "$environment");
  isoDate(required(data, "recorded_utc", "$environment"), "$.recorded_utc");
  const system = required(data, "system", "$environment");
  object(system, "$.system");
  if (!["win32", "darwin", "linux"].includes(required(system, "platform", "$.system"))) validationError("$.system.platform", "must be a supported platform");
  if (!["x64", "arm64", "x32"].includes(required(system, "arch", "$.system"))) validationError("$.system.arch", "must be a supported architecture");
  for (const key of ["node", "pnpm"]) {
    const tool = required(data, key, "$environment");
    object(tool, `$.${key}`);
    string(required(tool, "version", `$.${key}`), `$.${key}.version`);
  }
}

function validateScenarios(data) {
  object(data, "$scenarios");
  const scenarios = required(data, "scenarios", "$scenarios");
  if (!Array.isArray(scenarios)) validationError("$.scenarios", "must be an array");
  for (const [index, scenario] of scenarios.entries()) {
    const path = `$.scenarios[${index}]`;
    object(scenario, path);
    string(required(scenario, "scenario_id", path), `${path}.scenario_id`, /^(CHR|EDGE)-\d{3}$/);
    const ids = required(scenario, "requirement_ids", path);
    if (!Array.isArray(ids)) validationError(`${path}.requirement_ids`, "must be an array");
    for (const [idIndex, id] of ids.entries()) string(id, `${path}.requirement_ids[${idIndex}]`, /^(FR|NFR|US|TD)-\d{3}$/);
    const status = required(scenario, "status", path);
    if (!["pass", "fail", "blocked", "not-run"].includes(status)) validationError(`${path}.status`, "is not an allowed status");
    if (!["must-have", "should-have"].includes(required(scenario, "priority", path))) validationError(`${path}.priority`, "is not an allowed priority");
    if (status === "fail") {
      string(required(scenario, "defect_id", path), `${path}.defect_id`, /^(DEF|S)-\d{3}$/);
    } else if ("defect_id" in scenario) {
      string(scenario.defect_id, `${path}.defect_id`, /^(DEF|S)-\d{3}$/);
    }
  }
}

function validateDefectRecord(data) {
  object(data, "$defect");
  string(required(data, "defect_id", "$defect"), "$.defect_id", /^(DEF|S)-\d{3}$/);
  string(required(data, "scenario_id", "$defect"), "$.scenario_id", /^(CHR|EDGE)-\d{3}$/);

  const contractIds = required(data, "affected_contract_ids", "$defect");
  if (!Array.isArray(contractIds) || contractIds.length === 0) validationError("$.affected_contract_ids", "must be a non-empty array");
  for (const [index, id] of contractIds.entries()) string(id, `$.affected_contract_ids[${index}]`, /^(FR|NFR|US|TD)-\d{3}$/);

  const reproductionSteps = required(data, "reproduction_steps", "$defect");
  if (!Array.isArray(reproductionSteps) || reproductionSteps.length === 0) validationError("$.reproduction_steps", "must be a non-empty array");
  for (const [index, step] of reproductionSteps.entries()) nonEmptyString(step, `$.reproduction_steps[${index}]`);

  nonEmptyString(required(data, "observed_behavior", "$defect"), "$.observed_behavior");
  nonEmptyString(required(data, "expected_behavior", "$defect"), "$.expected_behavior");
  string(required(data, "build_candidate_id", "$defect"), "$.build_candidate_id", /^release-[a-z0-9-]+$/);
  if (!["release-blocking", "non-blocking", "edge-only"].includes(required(data, "severity", "$defect"))) validationError("$.severity", "is not an allowed severity");
  if (!["code-fix", "requirement-reopening", "tooling-evidence-failure", "deferred-non-blocking", "not-reproducible"].includes(required(data, "disposition", "$defect"))) validationError("$.disposition", "is not an allowed disposition");
  if (!["open", "fixed", "reopened", "blocked"].includes(required(data, "status", "$defect"))) validationError("$.status", "is not an allowed status");

  const evidencePaths = required(data, "evidence_paths", "$defect");
  if (!Array.isArray(evidencePaths) || evidencePaths.length === 0) validationError("$.evidence_paths", "must be a non-empty array");
  for (const [index, evidencePath] of evidencePaths.entries()) nonEmptyString(evidencePath, `$.evidence_paths[${index}]`);
}

function validatePerformance(data) {
  object(data, "$performance");
  isoDate(required(data, "recorded_utc", "$performance"), "$.recorded_utc");
  for (const key of ["page_url", "workload_description"]) string(required(data, key, "$performance"), `$.${key}`);
  const samples = required(data, "baseline_samples", "$performance");
  if (!Array.isArray(samples) || samples.length < 10 || samples.length > 20) validationError("$.baseline_samples", "must contain 10 to 20 samples");
  for (const [index, sample] of samples.entries()) {
    const path = `$.baseline_samples[${index}]`;
    object(sample, path);
    if (!Number.isInteger(required(sample, "sample_id", path))) validationError(`${path}.sample_id`, "must be an integer");
    const duration = required(sample, "duration_ms", path);
    if (typeof duration !== "number" || duration < 0) validationError(`${path}.duration_ms`, "must be a non-negative number");
    isoDate(required(sample, "executed_utc", path), `${path}.executed_utc`);
  }
  const calculation = required(data, "calculation", "$performance");
  object(calculation, "$.calculation");
  if (required(calculation, "method", "$.calculation") !== "standard-max-of-2x-or-plus-250") validationError("$.calculation.method", "has an invalid value");
  for (const key of ["median_ms", "ceiling_ms"]) if (typeof required(calculation, key, "$.calculation") !== "number") validationError(`$.calculation.${key}`, "must be a number");
  string(required(calculation, "ceiling_justification", "$.calculation"), "$.calculation.ceiling_justification");
}

function validateManifest(data) {
  if (data && "candidate_id" in data) return validateBuildManifest(data);
  if (data && "defect_id" in data) return validateDefectRecord(data);
  if (data && "scenarios" in data) return validateScenarios(data);
  if (data && "system" in data) return validateEnvironment(data);
  if (data && "baseline_samples" in data) return validatePerformance(data);
  fail("Cannot determine evidence schema from candidate_id, defect_id, scenarios, system, or baseline_samples");
}

function generateManifest() {
  const release = computeReleaseFiles();
  const sourceFingerprint = computeSourceFingerprint();
  const commands = Object.fromEntries(REQUIRED_COMMANDS.map(([name, command]) => [name, runCommand(command)]));
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15).toLowerCase();
  const releaseIdentity = sha256(JSON.stringify(release.release_files));
  const manifest = {
    candidate_id: `release-${sourceFingerprint.fingerprint_value.slice(0, 12)}-${releaseIdentity.slice(0, 12)}-${timestamp}`,
    created_utc: new Date().toISOString(),
    app_version: JSON.parse(readFileSync(resolve("package.json"), "utf8")).version,
    node_version: commandVersion("node --version"),
    pnpm_version: commandVersion("pnpm --version"),
    typescript_version: packageVersion("typescript"),
    vite_version: packageVersion("vite"),
    esbuild_version: packageVersion("esbuild"),
    source_fingerprint: sourceFingerprint,
    ...release,
    commands,
  };
  validateBuildManifest(manifest);
  writeFileSync(BUILD_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`PASS: wrote ${relativePath(BUILD_MANIFEST_PATH)} (${manifest.candidate_id})`);
}

function verifyManifest(path) {
  const manifest = JSON.parse(readFileSync(resolve(path), "utf8"));
  validateBuildManifest(manifest);
  const currentRelease = computeReleaseFiles();
  const currentSource = computeSourceFingerprint();
  const differences = [];
  if (JSON.stringify(currentRelease.files) !== JSON.stringify(manifest.files)) differences.push("required release-file hashes");
  if (JSON.stringify(currentRelease.release_files) !== JSON.stringify(manifest.release_files)) differences.push("generated release-file hashes");
  if (currentSource.fingerprint_value !== manifest.source_fingerprint.fingerprint_value) differences.push("source fingerprint");
  if (differences.length) fail(`Candidate mismatch: ${differences.join(", ")}. Regenerate with pnpm run evidence:build.`);
  console.log(`PASS: candidate identity matches ${relativePath(resolve(path))}`);
}

function selfTestFailClosed() {
  const passing = { command: "pnpm test", exit_code: 0, status: "pass", executed_utc: "2026-07-25T00:00:00.000Z" };
  const baseline = {
    candidate_id: "release-self-test", created_utc: "2026-07-25T00:00:00.000Z", app_version: "0.1.0", node_version: "v24.0.0", pnpm_version: "10.0.0", typescript_version: "5.9.0", vite_version: "7.0.0", esbuild_version: "0.28.0",
    source_fingerprint: { files_included: ["src/example.ts"], fingerprint_method: "sha256-sorted-file-hashes", fingerprint_value: "a".repeat(64) },
    files: { manifest_json: "a".repeat(64), background_js: "b".repeat(64), content_js: "c".repeat(64), panel_html: "d".repeat(64) },
    release_files: [{ path: "dist/background.js", sha256: "b".repeat(64) }],
    commands: { test: passing, typecheck: { ...passing, command: "pnpm typecheck" }, build: { ...passing, command: "pnpm build" } },
  };
  const mustReject = (label, validator, data) => {
    try { validator(data); } catch { console.log(`PASS: ${label} is rejected`); return; }
    fail(`FAIL: ${label} was accepted`);
  };
  mustReject("a failed required command recorded as pass", validateBuildManifest, { ...baseline, commands: { ...baseline.commands, test: { ...passing, exit_code: 1 } } });
  const { typecheck, ...missing } = baseline.commands;
  mustReject("a missing required command", validateBuildManifest, { ...baseline, commands: missing });

  const defect = {
    defect_id: "S-001",
    scenario_id: "CHR-001",
    affected_contract_ids: ["NFR-005", "TD-001"],
    reproduction_steps: ["Run the documented evidence-schema inventory.", "Inspect schema/ for defect-record.schema.json."],
    observed_behavior: "The original contract lacked a machine-readable defect schema and validator route.",
    expected_behavior: "A failed scenario has a validated defect record linked by defect_id.",
    build_candidate_id: "release-schema-fixture-identity",
    severity: "release-blocking",
    disposition: "code-fix",
    status: "fixed",
    evidence_paths: ["schema/examples/defect-record.valid.json"],
  };
  validateDefectRecord(defect);
  console.log("PASS: a conforming defect record is accepted");
  const { observed_behavior, ...missingObservedBehavior } = defect;
  mustReject("a defect missing observed_behavior", validateDefectRecord, missingObservedBehavior);
  mustReject("a defect with an invalid identifier", validateDefectRecord, { ...defect, defect_id: "defect-1" });
  mustReject("a defect with an invalid severity", validateDefectRecord, { ...defect, severity: "urgent" });
  mustReject("a defect with an invalid disposition", validateDefectRecord, { ...defect, disposition: "ignore" });
  mustReject("a defect with an invalid build identity", validateDefectRecord, { ...defect, build_candidate_id: "candidate-123" });

  const failedScenario = {
    scenarios: [{ scenario_id: "CHR-001", requirement_ids: ["FR-010"], status: "fail", priority: "must-have" }],
  };
  mustReject("a failed scenario without defect_id", validateScenarios, failedScenario);
  validateScenarios({ scenarios: [{ ...failedScenario.scenarios[0], defect_id: "S-001" }] });
  console.log("PASS: a failed scenario with a valid defect_id is accepted");
}

function main() {
  const [command, path, ...extra] = process.argv.slice(2);
  if (extra.length) fail("Only one evidence command may be supplied");
  if (!command) return generateManifest();
  if (command === "--verify-manifest" && path) return verifyManifest(path);
  if (command === "--validate" && path) {
    validateManifest(JSON.parse(readFileSync(resolve(path), "utf8")));
    console.log(`PASS: ${relativePath(resolve(path))} validates against its documented schema`);
    return;
  }
  if (command === "--self-test-fail-closed" && !path) return selfTestFailClosed();
  fail("Usage: node scripts/release-evidence.mjs [--verify-manifest <path> | --validate <path> | --self-test-fail-closed]");
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
