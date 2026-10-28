import assert from "node:assert/strict";
import test from "node:test";
import {
  compareWords,
  evaluate,
  tokens,
  summary,
  command,
  TWISTERS,
  type Evaluation,
} from "../lib/game";
import { sessionCapability, verifyCapability } from "../lib/agent-auth";
import { POST } from "../app/api/evaluate/route";
import { POST as invite } from "../app/api/invite-agent/route";
import { POST as stop } from "../app/api/stop-conversation/route";

test("ten Hindi levels and Unicode-safe word matching", () => {
  assert.equal(TWISTERS.length, 10);
  for (const item of TWISTERS) assert.match(item.text, /[\u0900-\u097f]/);
  assert.equal(
    compareWords("कच्चा पापड़, पक्का पापड़।", "कच्चा पापड़ पक्का पापड़").match,
    100,
  );
  assert.deepEqual(tokens("क़लम"), tokens("क़लम"));
  assert.equal(compareWords("की", "कि").match, 0); // vowel marks matter
});

test("missing, substituted, repeated and extra words affect the score", () => {
  const missing = compareWords("कच्चा पापड़ पक्का पापड़", "कच्चा पापड़ पापड़");
  assert.equal(missing.match, 75);
  assert.ok(
    missing.differences.some(
      (item) => item.kind === "missing" && item.expected === "पक्का",
    ),
  );
  assert.ok(
    compareWords("कच्चा पापड़", "पक्का पापड़").differences.some(
      (item) => item.kind === "substitution",
    ),
  );
  assert.ok(
    compareWords("कच्चा पापड़", "कच्चा पापड़ पापड़").differences.some(
      (item) => item.kind === "extra",
    ),
  );
  assert.equal(compareWords("कच्चा पापड़", "").match, 0);
});

test("speed points require 90% match and cannot exceed the per-level maximum", () => {
  assert.equal(evaluate(0, TWISTERS[0].text, 2).score, 1000);
  assert.equal(evaluate(0, "कच्चा पापड़ पापड़", 0.5).score, 600);
  assert.ok(evaluate(0, TWISTERS[0].text, 20).score < 1000);
});

test("summary uses best attempt per level and only measured results", () => {
  const fake = (score: number, match: number): Evaluation => ({
    level: 0,
    score,
    match,
    transcript: "कच्चा पापड़",
    differences: [],
    speakingSeconds: 2.5,
    processingMs: 99999,
    words: [],
    alignmentWarning: null,
  });
  const report = summary([
    { level: 0, attempts: [fake(700, 75), fake(1000, 100)] },
  ]);
  assert.equal(report.score, 1000);
  assert.equal(report.passed, 1);
  assert.equal(report.seconds, 2.5);
  assert.equal(report.average, 100);
  assert.equal(summary([]).score, 0);
});

test("voice controls accept Hindi and English without matching an ordinary recitation", () => {
  assert.equal(command("शुरू करो!"), "start");
  assert.equal(command("अगला"), "next");
  assert.equal(command("फिर से"), "retry");
  assert.equal(command("दोहराओ"), "repeat");
  for (const item of TWISTERS) assert.equal(command(item.text), null);
});

test("stop capability is scoped, expiring and tamper resistant", () => {
  const previous = process.env.NEXT_AGORA_APP_CERTIFICATE;
  process.env.NEXT_AGORA_APP_CERTIFICATE = "c".repeat(32);
  const token = sessionCapability("agent-one", "room-one");
  assert.equal(verifyCapability(token, "agent-one"), true);
  assert.equal(verifyCapability(token, "agent-two"), false);
  assert.equal(verifyCapability(token + "x", "agent-one"), false);
  assert.equal(verifyCapability(null, "agent-one"), false);
  if (previous === undefined) delete process.env.NEXT_AGORA_APP_CERTIFICATE;
  else process.env.NEXT_AGORA_APP_CERTIFICATE = previous;
});

test("game routes validate before making paid provider calls", async () => {
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/evaluate?level=20", {
          method: "POST",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/evaluate?level=0", {
          method: "POST",
          headers: { origin: "https://other.example" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await invite(
        new Request("http://localhost/api/invite-agent", {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await stop(
        new Request("http://localhost/api/stop-conversation", {
          method: "POST",
          body: JSON.stringify({ agent_id: "someone-elses-agent" }),
        }),
      )
    ).status,
    403,
  );
});

test("full evaluation route ignores model-provided scores and never reveals the target to inference", async () => {
  const { encodeWav } = await import("../lib/wav");
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.NEMOTRON_BASE_URL;
  process.env.NEMOTRON_BASE_URL = "http://127.0.0.1:8000/v1";
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init!.body as string);
    assert.equal(
      payload.messages[0].content[0].text.includes(TWISTERS[0].text),
      false,
    );
    assert.match(payload.messages[0].content[0].text, /Devanagari/);
    return Response.json({
      score: 999999,
      choices: [
        { finish_reason: "stop", message: { content: TWISTERS[0].text } },
      ],
    });
  };
  try {
    const response = await POST(
      new Request("http://localhost/api/evaluate?level=0&seconds=1.5", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: encodeWav(new Float32Array(32000).fill(0.1)),
      }),
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.score, 1000);
    assert.equal(result.match, 100);
    assert.equal(result.speakingSeconds, 1.5);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.NEMOTRON_BASE_URL;
    else process.env.NEMOTRON_BASE_URL = previousBase;
  }
});

test("readiness rejects missing or unloaded inference before a paid host session is started", async () => {
  const { GET } = await import("../app/api/readiness/route");
  const previousFetch = globalThis.fetch,
    previousBase = process.env.NEMOTRON_BASE_URL;
  delete process.env.NEMOTRON_BASE_URL;
  try {
    assert.equal(
      (await GET(new Request("http://localhost/api/readiness"))).status,
      503,
    );
    process.env.NEMOTRON_BASE_URL = "http://127.0.0.1:8000/v1";
    globalThis.fetch = async () =>
      Response.json({ data: [{ id: "wrong-model" }] });
    assert.equal(
      (await GET(new Request("http://localhost/api/readiness"))).status,
      503,
    );
    globalThis.fetch = async () =>
      Response.json({
        data: [{ id: "nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B" }],
      });
    assert.equal(
      (await GET(new Request("http://localhost/api/readiness"))).status,
      200,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.NEMOTRON_BASE_URL;
    else process.env.NEMOTRON_BASE_URL = previousBase;
  }
});

test("English catalog, host language and scoring remain separate from Hindi", async () => {
  const {
    ENGLISH_TWISTERS,
    twistersFor,
    hostInstructions,
    hostGreeting,
    transcriptionInstruction,
  } = await import("../lib/game");
  assert.equal(ENGLISH_TWISTERS.length, 10);
  assert.equal(twistersFor("hi"), TWISTERS);
  for (const item of ENGLISH_TWISTERS) {
    assert.equal(
      evaluate(item.id, item.text.toUpperCase(), item.target, "en").score,
      1000,
    );
    assert.equal(evaluate(item.id, TWISTERS[item.id].text, 1, "en").score, 0);
  }
  assert.match(hostInstructions("en"), /Speak only conversational English/);
  assert.match(hostGreeting("en"), /Say start/);
  assert.match(transcriptionInstruction("en"), /English speech in English/);
  assert.equal(command("try again"), "retry");
  assert.equal(command("next"), "next");
});

test("English evaluation passes only a neutral English prompt and validates language", async () => {
  const { ENGLISH_TWISTERS } = await import("../lib/game");
  const { encodeWav } = await import("../lib/wav");
  const previousFetch = globalThis.fetch,
    previousBase = process.env.NEMOTRON_BASE_URL;
  process.env.NEMOTRON_BASE_URL = "http://127.0.0.1:8000/v1";
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init!.body as string);
    const instruction = payload.messages[0].content[0].text;
    assert.match(instruction, /English speech in English/);
    assert.equal(instruction.includes(ENGLISH_TWISTERS[0].text), false);
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: ENGLISH_TWISTERS[0].text },
        },
      ],
    });
  };
  try {
    const result = await POST(
      new Request(
        "http://localhost/api/evaluate?level=0&language=en&seconds=1",
        {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: encodeWav(new Float32Array(32000).fill(0.1)),
        },
      ),
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).score, 1000);
    assert.equal(
      (
        await POST(
          new Request("http://localhost/api/evaluate?level=0&language=fr", {
            method: "POST",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await invite(
          new Request("http://localhost/api/invite-agent", {
            method: "POST",
            body: JSON.stringify({ language: "fr" }),
          }),
        )
      ).status,
      400,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.NEMOTRON_BASE_URL;
    else process.env.NEMOTRON_BASE_URL = previousBase;
  }
});
