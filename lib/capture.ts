import { type AudioInput, SAMPLE_RATE } from "./contracts";
import { encodeWav } from "./wav";

export class CallCapture {
  private context: AudioContext;
  private node: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;
  private inputs = new Map<
    string,
    {
      track: MediaStreamTrack;
      source: MediaStreamAudioSourceNode;
      gain: GainNode;
    }
  >();
  private chunks: Float32Array[] = [];
  private finished = false;
  private cancelled = false;
  private resolve!: (blob: Blob) => void;
  private reject!: (error: Error) => void;
  readonly result: Promise<Blob>;

  constructor() {
    this.context = new AudioContext();
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // A caller may cancel while startup is still awaiting worklet loading.
    void this.result.catch(() => {});
  }

  async start(inputs: AudioInput[]) {
    if (!window.isSecureContext || !this.context.audioWorklet)
      throw new Error(
        "Recording needs HTTPS or localhost and a browser with AudioWorklet support.",
      );
    await this.context.resume();
    await this.context.audioWorklet.addModule("/pcm-recorder.js");
    if (this.cancelled) throw new Error("Recording cancelled.");
    this.node = new AudioWorkletNode(this.context, "pcm-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
    });
    this.mute = this.context.createGain();
    this.mute.gain.value = 0;
    this.node.connect(this.mute);
    this.mute.connect(this.context.destination);
    this.node.onprocessorerror = () => {
      this.reject(
        new Error("Audio processing stopped unexpectedly. Please retry."),
      );
      this.cancelled = true;
      void this.cleanup();
    };
    this.node.port.onmessage = (event) => {
      if (this.finished || this.cancelled) return;
      if (event.data.type === "samples") this.chunks.push(event.data.data);
      if (event.data.type === "finished") void this.finish();
    };
    this.update(inputs);
  }

  update(inputs: AudioInput[]) {
    if (!this.node || this.finished || this.cancelled) return;
    const ids = new Set(inputs.map((input) => input.id));
    for (const [id, current] of this.inputs) {
      if (
        !ids.has(id) ||
        inputs.find((input) => input.id === id)?.track !== current.track
      ) {
        current.source.disconnect();
        current.gain.disconnect();
        this.inputs.delete(id);
      }
    }
    const enabledCount = Math.max(
      1,
      inputs.filter((input) => input.enabled).length,
    );
    for (const input of inputs) {
      let current = this.inputs.get(input.id);
      if (!current) {
        const source = this.context.createMediaStreamSource(
          new MediaStream([input.track]),
        );
        const gain = this.context.createGain();
        source.connect(gain);
        gain.connect(this.node);
        current = { track: input.track, source, gain };
        this.inputs.set(input.id, current);
      }
      current.gain.gain.setTargetAtTime(
        input.enabled ? 1 / enabledCount : 0,
        this.context.currentTime,
        0.01,
      );
    }
  }

  stop() {
    this.node?.port.postMessage("stop");
  }

  cancel() {
    this.cancelled = true;
    this.reject(new Error("Recording discarded."));
    void this.cleanup();
  }

  private async finish() {
    this.finished = true;
    const rate = this.context.sampleRate;
    const length = this.chunks.reduce(
      (total, chunk) => total + chunk.length,
      0,
    );
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      await this.cleanup();
      if (this.cancelled) return;
      if (length / rate < 0.25)
        throw new Error("Record for at least a quarter of a second.");
      const renderer = new OfflineAudioContext(
        1,
        Math.floor((length / rate) * SAMPLE_RATE),
        SAMPLE_RATE,
      );
      const buffer = renderer.createBuffer(1, length, rate);
      buffer.copyToChannel(samples, 0);
      const source = renderer.createBufferSource();
      source.buffer = buffer;
      source.connect(renderer.destination);
      source.start();
      const output = await renderer.startRendering();
      if (!this.cancelled)
        this.resolve(
          new Blob([encodeWav(output.getChannelData(0))], {
            type: "audio/wav",
          }),
        );
    } catch (error) {
      this.reject(
        error instanceof Error
          ? error
          : new Error("Unable to encode recording."),
      );
    }
  }

  private async cleanup() {
    for (const input of this.inputs.values()) {
      input.source.disconnect();
      input.gain.disconnect();
    }
    this.inputs.clear();
    this.node?.disconnect();
    this.mute?.disconnect();
    this.chunks = [];
    if (this.context.state !== "closed") await this.context.close();
  }
}
