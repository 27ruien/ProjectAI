const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim() || "local";

export const APP_RUNTIME = Object.freeze({
  environment,
  version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "0.4.0-staging",
  commitSha,
  shortCommitSha: commitSha === "local" ? commitSha : commitSha.slice(0, 8),
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME?.trim() || "本地构建",
  isStaging: environment.toLowerCase() === "staging",
});
