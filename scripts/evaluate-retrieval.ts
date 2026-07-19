import { writeHybridRetrievalEvaluation } from "../lib/ai/retrieval/evaluation";

const result = await writeHybridRetrievalEvaluation();
process.stdout.write(
  `${JSON.stringify({
    datasetVersion: result.datasetVersion,
    queryCount: result.queryCount,
    profileId: result.profile.id,
    vectorMaxDistance: result.profile.vectorMaxDistance,
    lexicalMetrics: result.overall.lexicalMetrics,
    vectorMetrics: result.overall.vectorMetrics,
    hybridMetrics: result.overall.hybridMetrics,
    comparisons: result.comparisons,
    safety: result.safety,
    gates: result.gates,
    passed: result.passed,
  })}\n`,
);
if (!result.passed) process.exitCode = 1;
