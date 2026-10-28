import { inferenceConfigured } from "@/lib/nemotron";
import ZubaanGame from "@/components/zubaan-game";
import { MODEL } from "@/lib/contracts";
export const dynamic = "force-dynamic";
export default function Home() {
  return (
    <ZubaanGame
      setup={{
        agora:
          /^[a-f0-9]{32}$/i.test(process.env.NEXT_PUBLIC_AGORA_APP_ID || "") &&
          /^[a-f0-9]{32}$/i.test(process.env.NEXT_AGORA_APP_CERTIFICATE || ""),
        inference: inferenceConfigured(),
        inferenceProvider:
          process.env.NEMOTRON_PROVIDER === "hf-space" ? "hf-space" : "vllm",
        model: process.env.NEMOTRON_MODEL || MODEL,
      }}
    />
  );
}
