import { randomBytes } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = resolve(
  process.env.UAT_CREDENTIALS_FILE || ".local/secrets/staging_uat_accounts.json",
);

function password(): string {
  return `Uat-${randomBytes(18).toString("base64url")}-9z`;
}

await mkdir(dirname(output), { recursive: true, mode: 0o700 });
try {
  await stat(output);
  throw new Error("UAT_CREDENTIALS_FILE_ALREADY_EXISTS");
} catch (error) {
  if (error instanceof Error && error.message === "UAT_CREDENTIALS_FILE_ALREADY_EXISTS") {
    throw error;
  }
}

await writeFile(
  output,
  `${JSON.stringify(
    {
      accounts: [
        { key: "admin", email: "admin@test.local", password: password() },
        { key: "pm-a", email: "pm-a@test.local", password: password() },
        { key: "pm-ab", email: "pm-ab@test.local", password: password() },
      ],
    },
    null,
    2,
  )}\n`,
  { mode: 0o600, flag: "wx" },
);

console.log(JSON.stringify({ created: true, output, mode: "0600", accountCount: 3 }));
