export const WHISPER_SAMPLE_RATE = 16_000;

export function resamplePcm(input: Float32Array, sourceRate: number, targetRate = WHISPER_SAMPLE_RATE): Float32Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error("invalid-sample-rate");
  }
  if (sourceRate === targetRate) return input;

  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  if (ratio > 1) {
    for (let index = 0; index < outputLength; index += 1) {
      const start = index * ratio;
      const end = Math.min(input.length, (index + 1) * ratio);
      const first = Math.floor(start);
      const last = Math.min(input.length - 1, Math.ceil(end) - 1);
      let weightedSum = 0;
      let totalWeight = 0;
      for (let sourceIndex = first; sourceIndex <= last; sourceIndex += 1) {
        const weight = Math.max(0, Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex));
        weightedSum += input[sourceIndex] * weight;
        totalWeight += weight;
      }
      output[index] = totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
    return output;
  }

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    output[index] = input[left] * (1 - mix) + input[right] * mix;
  }
  return output;
}
