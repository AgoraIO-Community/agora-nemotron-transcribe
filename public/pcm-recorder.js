// Capture the mixed call, without stopping or taking ownership of RTC tracks.
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(2048);
    this.offset = 0;
    this.frames = 0;
    this.finished = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.finish();
    };
  }
  flush() {
    if (!this.offset) return;
    const data = this.pending.slice(0, this.offset);
    this.port.postMessage({ type: "samples", data }, [data.buffer]);
    this.offset = 0;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.flush();
    this.port.postMessage({ type: "finished" });
  }
  process(inputs) {
    if (this.finished) return false;
    const input = inputs[0]?.[0];
    if (input) {
      for (const value of input) {
        if (this.frames >= sampleRate * 120) {
          this.finish();
          return false;
        }
        this.pending[this.offset++] = value;
        this.frames++;
        if (this.offset === this.pending.length) this.flush();
      }
    }
    // Output stays silent: remote audio is already played by the Agora SDK.
    return true;
  }
}
registerProcessor("pcm-recorder", PcmRecorder);
