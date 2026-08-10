const CHUNK_SIZE = 2048;
const HEALTH_INTERVAL_FRAMES = 8;

class ScoreTrackerAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.captureId = 0;
    this.gateOpen = false;
    this.chunk = new Float32Array(CHUNK_SIZE);
    this.chunkLength = 0;
    this.framesReceived = 0;
    this.samplesReceived = 0;

    this.port.onmessage = ({ data }) => {
      if (data?.type === "gate") {
        if (data.open) {
          this.captureId = data.captureId;
          this.chunkLength = 0;
          this.gateOpen = true;
        } else if (data.captureId === this.captureId) {
          this.gateOpen = false;
          this.flush();
          this.port.postMessage({ type: "flushed", captureId: this.captureId });
        }
      }
    };

    this.port.postMessage({ type: "ready", sampleRate });
  }

  flush() {
    if (this.chunkLength === 0) return;
    const output = this.chunk.slice(0, this.chunkLength);
    this.chunkLength = 0;
    this.port.postMessage({ type: "pcm", captureId: this.captureId, audio: output }, [output.buffer]);
  }

  append(samples) {
    let offset = 0;
    while (offset < samples.length) {
      const count = Math.min(samples.length - offset, CHUNK_SIZE - this.chunkLength);
      this.chunk.set(samples.subarray(offset, offset + count), this.chunkLength);
      this.chunkLength += count;
      offset += count;
      if (this.chunkLength === CHUNK_SIZE) this.flush();
    }
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;

    const length = channels[0].length;
    const mono = new Float32Array(length);
    let sumSquares = 0;
    let peak = 0;

    for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
      let mixed = 0;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        mixed += channels[channelIndex][sampleIndex] || 0;
      }
      const sample = mixed / channels.length;
      mono[sampleIndex] = sample;
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      sumSquares += sample * sample;
    }

    this.framesReceived += 1;
    this.samplesReceived += length;
    if (this.gateOpen) this.append(mono);

    if (this.framesReceived % HEALTH_INTERVAL_FRAMES === 0) {
      this.port.postMessage({
        type: "health",
        framesReceived: this.framesReceived,
        samplesReceived: this.samplesReceived,
        rms: Math.sqrt(sumSquares / length),
        peak,
      });
    }
    return true;
  }
}

registerProcessor("score-tracker-audio-capture", ScoreTrackerAudioCaptureProcessor);
