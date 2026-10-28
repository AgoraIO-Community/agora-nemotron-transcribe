import { FREE_SPACE, freeSpaceHeaders } from "@/lib/hf-space";
import { json, sameOrigin } from "@/lib/http";
import { inferenceConfig } from "@/lib/nemotron";
export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Cross-origin request rejected." }, 403);
  let config;
  try {
    config = inferenceConfig();
  } catch {
    return json(
      {
        error:
          "Connect NVIDIA first: set NEMOTRON_BASE_URL to a running NeMo/vLLM server. See README.md.",
      },
      503,
    );
  }
  try {
    if (config.provider === "hf-space") {
      const response = await fetch(`${FREE_SPACE}/gradio_api/info`, {
        headers: freeSpaceHeaders(),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok)
        return json(
          {
            error:
              "The free Hugging Face Space is waking up or unavailable. Try again shortly.",
          },
          503,
        );
      const info = await response.json();
      if (
        !info.named_endpoints?.["/transcribe"]?.parameters?.some(
          (parameter: { parameter_name?: string }) =>
            parameter.parameter_name === "instruction",
        )
      )
        return json(
          {
            error:
              "The free Space API has changed. No host session was opened.",
          },
          503,
        );
      return json({
        ready: true,
        provider: "hf-space",
        notice:
          "Free shared GPU: requests may queue or hit a daily quota. Availability does not reserve GPU time.",
      });
    }
    const response = await fetch(`${config.base}/models`, {
      headers: config.key ? { Authorization: `Bearer ${config.key}` } : {},
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok)
      return json(
        {
          error:
            "NVIDIA server authentication or model discovery failed. Check the endpoint and server-side API key.",
        },
        503,
      );
    const models = await response.json();
    if (
      !Array.isArray(models.data) ||
      !models.data.some((model: { id?: string }) => model.id === config.model)
    )
      return json(
        {
          error:
            "The configured Nemotron model is not loaded. Match NEMOTRON_MODEL to the vLLM served model name.",
        },
        503,
      );
    return json({ ready: true });
  } catch {
    return json(
      {
        error:
          config.provider === "hf-space"
            ? "The free Hugging Face Space is not reachable. Try again shortly."
            : "NVIDIA server is not reachable. Start inference/serve.sh on your GPU host and connect its endpoint or SSH tunnel before playing.",
      },
      503,
    );
  }
}
