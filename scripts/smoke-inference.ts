import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { transcribe } from "../lib/nemotron";
import { inspectWav } from "../lib/wav";
if (existsSync(".env.local")) loadEnvFile(".env.local");
async function main() {
  try {
    const bytes = new Uint8Array(readFileSync("public/sample.wav"));
    const { duration } = inspectWav(bytes);
    const result = await transcribe(
      bytes,
      duration,
      "verbatim",
      "",
      false,
      new AbortController().signal,
    );
    console.log(result.text);
    console.log(
      `Completed in ${(result.processingMs / 1000).toFixed(1)} seconds. Model: ${result.model}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Inference failed.");
    process.exitCode = 1;
  }
}
void main();
