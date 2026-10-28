import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function fixture() {
  const messages: { type: string; data?: Float32Array }[] = [];
  let Processor: new () => {
    process(input: Float32Array[][]): boolean;
    port: { onmessage: (message: { data: string }) => void };
  };
  vm.runInNewContext(
    readFileSync(new URL("../public/pcm-recorder.js", import.meta.url), "utf8"),
    {
      AudioWorkletProcessor: class {
        port = {
          onmessage: null,
          postMessage: (message: { type: string; data?: Float32Array }) =>
            messages.push(message),
        };
      },
      registerProcessor: (_: string, constructor: typeof Processor) => {
        Processor = constructor;
      },
      sampleRate: 100,
    },
  );
  return { processor: new Processor!(), messages };
}

test("recording stop flushes partial PCM blocks instead of losing final syllables", () => {
  const { processor, messages } = fixture();
  for (let index = 0; index < 5; index++)
    processor.process([[new Float32Array(128).fill(0.25)]]);
  processor.port.onmessage({ data: "stop" });
  assert.equal(
    messages
      .filter((message) => message.type === "samples")
      .reduce((sum, message) => sum + message.data!.length, 0),
    640,
  );
  assert.equal(messages.at(-1)?.type, "finished");
  assert.equal(processor.process([[new Float32Array(128)]]), false);
});

test("worklet caps recording by audio frame count even when UI timers are delayed", () => {
  const { processor, messages } = fixture();
  for (let index = 0; index < 100; index++)
    processor.process([[new Float32Array(128)]]);
  assert.equal(
    messages
      .filter((message) => message.type === "samples")
      .reduce((sum, message) => sum + message.data!.length, 0),
    12000,
  );
  assert.equal(
    messages.filter((message) => message.type === "finished").length,
    1,
  );
});
