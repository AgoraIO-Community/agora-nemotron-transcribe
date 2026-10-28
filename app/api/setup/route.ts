import { inferenceConfigured } from "@/lib/nemotron";
import { MODEL } from "@/lib/contracts";
import { json } from "@/lib/http";
export function GET() {
  return json({
    agora:
      /^[a-f0-9]{32}$/i.test(process.env.NEXT_PUBLIC_AGORA_APP_ID || "") &&
      /^[a-f0-9]{32}$/i.test(process.env.NEXT_AGORA_APP_CERTIFICATE || ""),
    inference: inferenceConfigured(),
    inferenceProvider:
      process.env.NEMOTRON_PROVIDER === "hf-space" ? "hf-space" : "vllm",
    model: process.env.NEMOTRON_MODEL || MODEL,
  });
}
