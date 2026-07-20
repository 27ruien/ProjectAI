const shaPattern = /^[0-9a-f]{40}$/;
const decimalIdPattern = /^[1-9][0-9]*$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function fail(message) {
  throw new Error(message);
}

function isNonEmptySafeString(value) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 255 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    isoTimestampPattern.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isCommitSha(value) {
  return typeof value === "string" && shaPattern.test(value);
}

export function isDecimalId(value) {
  return typeof value === "string" && decimalIdPattern.test(value);
}

export function normalizeArtifactDigest(value) {
  if (typeof value !== "string") {
    fail("The evidence artifact digest is missing.");
  }
  const match = value.trim().match(/^(?:sha256:)?([0-9a-f]{64})$/i);
  if (!match) {
    fail("The evidence artifact digest is not a SHA-256 digest.");
  }
  return `sha256:${match[1].toLowerCase()}`;
}

export function assertEvidenceIndex(index, { ci = false } = {}) {
  if (!index || typeof index !== "object" || Array.isArray(index)) {
    fail("A valid product review evidence index is required.");
  }
  if (Object.hasOwn(index, "commit")) {
    fail("The legacy product review commit field is not allowed.");
  }
  if (Object.hasOwn(index, "artifactId")) {
    fail("The pre-upload evidence index must not contain artifactId.");
  }
  if (index.schemaVersion !== 3) {
    fail("The product review evidence index has an unsupported schemaVersion.");
  }

  const eventName = index.eventName;
  if (!['pull_request', 'push', 'local'].includes(eventName)) {
    fail("The product review evidence index has an unsupported eventName.");
  }
  if (ci && eventName === "local") {
    fail("CI product review evidence cannot use local event semantics.");
  }
  if (!ci && eventName !== "local" && !isCommitSha(index.headSha)) {
    fail("Non-local product review evidence requires a valid headSha.");
  }

  if (eventName === "local") {
    if (index.headSha !== null || index.testedMergeSha !== null) {
      fail("Local product review evidence must use null Git commit semantics.");
    }
    if (index.workflowRunId !== null) {
      fail("Local product review evidence must use a null workflowRunId.");
    }
  } else {
    if (!isCommitSha(index.headSha)) {
      fail("The product review evidence index has an invalid headSha.");
    }
    if (!isDecimalId(index.workflowRunId)) {
      fail("The product review evidence index has an invalid workflowRunId.");
    }
  }

  if (eventName === "pull_request") {
    if (!isCommitSha(index.testedMergeSha)) {
      fail("Pull request evidence requires a valid testedMergeSha.");
    }
  } else if (index.testedMergeSha !== null) {
    fail("Only pull request evidence may contain testedMergeSha.");
  }

  if (index.stagingSha !== null && !isCommitSha(index.stagingSha)) {
    fail("The product review evidence index has an invalid stagingSha.");
  }
  if (!isNonEmptySafeString(index.branch)) {
    fail("The product review evidence index has an invalid branch.");
  }
  if (!isNonEmptySafeString(index.environment)) {
    fail("The product review evidence index has an invalid environment.");
  }
  if (!isNonEmptySafeString(index.version)) {
    fail("The product review evidence index has an invalid version.");
  }
  if (!isIsoTimestamp(index.buildTime)) {
    fail("The product review evidence index has an invalid buildTime.");
  }
  for (const [field, value] of [
    ["workerVersion", index.workerVersion],
    ["parserVersion", index.parserVersion],
    ["chunkerVersion", index.chunkerVersion],
    ["aiGatewayVersion", index.aiGatewayVersion],
    ["assistantProfileId", index.assistantProfileId],
  ]) {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(value)
    ) {
      fail(`The product review evidence index has an invalid ${field}.`);
    }
  }
  for (const prefix of ["retrieval", "release"]) {
    const required = index[`required${prefix[0].toUpperCase()}${prefix.slice(1)}Reports`];
    const present = index[`${prefix}ReportFiles`];
    const missing = index[`missing${prefix[0].toUpperCase()}${prefix.slice(1)}Reports`];
    if (![required, present, missing].every(Array.isArray)) {
      fail(`The product review evidence index has an invalid ${prefix} report inventory.`);
    }
    for (const report of [...required, ...present, ...missing]) {
      if (
        typeof report !== "string" ||
        !/^[A-Za-z0-9._-]+\.(?:json|md)$/.test(report) ||
        report.includes("..")
      ) {
        fail(`The product review evidence index has an unsafe ${prefix} report name.`);
      }
    }
    const expectedMissing = required.filter((report) => !present.includes(report)).sort();
    if (
      new Set(required).size !== required.length ||
      new Set(present).size !== present.length ||
      new Set(missing).size !== missing.length ||
      present.some((report) => !required.includes(report)) ||
      JSON.stringify([...missing].sort()) !== JSON.stringify(expectedMissing)
    ) {
      fail(`The product review evidence index misstates ${prefix} report completeness.`);
    }
  }
  const releaseReportDigests = index.releaseReportDigests ?? [];
  if (!Array.isArray(releaseReportDigests)) {
    fail("The product review evidence index has an invalid Release report digest map.");
  }
  if (
    index.status?.toLowerCase() === "success" &&
    index.version?.startsWith("0.8.") &&
    !Array.isArray(index.releaseReportDigests)
  ) {
    fail("Successful B3-C1 evidence has no Release report digest map.");
  }
  const digestFilenames = new Set();
  for (const entry of releaseReportDigests) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !index.releaseReportFiles.includes(entry.filename) ||
      digestFilenames.has(entry.filename) ||
      !digestPattern.test(entry.sha256) ||
      !digestPattern.test(entry.reportDigest) ||
      typeof entry.reportType !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(entry.reportType) ||
      !isCommitSha(entry.releaseCandidateSha) ||
      !digestPattern.test(entry.releaseImageDigest)
    ) {
      fail("The product review Release report digest map is invalid.");
    }
    digestFilenames.add(entry.filename);
  }
  if (
    digestFilenames.size !== index.releaseReportFiles.length ||
    index.releaseReportFiles.some((filename) => !digestFilenames.has(filename))
  ) {
    fail("The product review Release report digest map is incomplete.");
  }
  if (!Array.isArray(index.screenshotFiles) || !Array.isArray(index.screenshots)) {
    fail("The product review evidence index has an invalid screenshot inventory.");
  }
  if (index.screenshots.length !== index.screenshotFiles.length) {
    fail("The product review screenshot dimensions are incomplete.");
  }
  const screenshotFiles = new Set(index.screenshotFiles);
  const screenshotNames = new Set();
  for (const screenshot of index.screenshots) {
    if (
      !screenshot ||
      typeof screenshot !== "object" ||
      typeof screenshot.filename !== "string" ||
      pathLikeFilenameInvalid(screenshot.filename) ||
      !Number.isSafeInteger(screenshot.width) ||
      screenshot.width < 1 ||
      !Number.isSafeInteger(screenshot.height) ||
      screenshot.height < 1
    ) {
      fail("The product review evidence index has invalid screenshot dimensions.");
    }
    const relativePath = `screenshots/${screenshot.filename}`;
    if (!screenshotFiles.has(relativePath) || screenshotNames.has(screenshot.filename)) {
      fail("The product review screenshot inventory is inconsistent.");
    }
    screenshotNames.add(screenshot.filename);
  }
  if (
    typeof index.status !== "string" ||
    !["success", "failure", "cancelled", "local"].includes(
      index.status.toLowerCase(),
    )
  ) {
    fail("The product review evidence index has an unsupported status.");
  }
  if (ci && index.status.toLowerCase() === "local") {
    fail("CI product review evidence cannot use local status.");
  }
}

function pathLikeFilenameInvalid(value) {
  return (
    value.trim() !== value ||
    !/^[A-Za-z0-9._-]+\.png$/i.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

export function assertPublishedArtifactIdentity({
  artifactId,
  artifactName,
  workflowRunId,
  expectedWorkflowRunId,
}) {
  if (!isDecimalId(artifactId)) {
    fail("The evidence artifactId is not a positive decimal identifier.");
  }
  if (!isNonEmptySafeString(artifactName)) {
    fail("The evidence artifact name is invalid.");
  }
  if (!isDecimalId(workflowRunId)) {
    fail("The published manifest has an invalid workflowRunId.");
  }
  if (
    expectedWorkflowRunId &&
    workflowRunId !== expectedWorkflowRunId.trim()
  ) {
    fail("The evidence artifact belongs to a different workflow run.");
  }
  if (
    !new RegExp(
      `^product-review-evidence-${workflowRunId}-[1-9][0-9]*$`,
    ).test(artifactName)
  ) {
    fail("The evidence artifact name does not match its workflow run.");
  }
}
