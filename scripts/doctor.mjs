import fs from "node:fs";
import { loadEnvFile } from "node:process";
if (fs.existsSync(".env.local")) loadEnvFile(".env.local");
if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Node.js 22 or newer is required.");
  process.exit(1);
}
for (const file of [
  "env.local.example",
  "public/pcm-recorder.js",
  "public/sample.wav",
]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
}
const agora =
  /^[a-f0-9]{32}$/i.test(process.env.NEXT_PUBLIC_AGORA_APP_ID || "") &&
  /^[a-f0-9]{32}$/i.test(process.env.NEXT_AGORA_APP_CERTIFICATE || "");
console.log(
  `Agora: ${agora ? "configured (live call not checked)" : "not configured; challenge preview remains available"}`,
);
if (process.env.NEMOTRON_PROVIDER === "hf-space") {
  console.log("Nemotron: free Hugging Face Space (shared GPU quota; reachability not checked)");
} else if (process.env.NEMOTRON_BASE_URL) {
  try {
    const url = new URL(process.env.NEMOTRON_BASE_URL);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    console.log("Nemotron: endpoint configured (reachability not checked)");
  } catch {
    console.error("NEMOTRON_BASE_URL must be an HTTP(S) API base URL.");
    process.exit(1);
  }
} else
  console.log(
    "Nemotron: not configured; set NEMOTRON_BASE_URL to enable real transcription",
  );
console.log(
  "Local prerequisites passed. No credentials or provider keys were printed.",
);
