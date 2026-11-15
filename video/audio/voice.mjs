// Voiceover with Kokoro-82M (open model, runs locally on CPU). One WAV per line; durations written to voice.json.
import { readFileSync, writeFileSync } from "node:fs";
import { KokoroTTS } from "kokoro-js";
const script = JSON.parse(readFileSync(new URL("./script.json", import.meta.url)));
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
const out = {};
for (const l of script.lines) {
  const audio = await tts.generate(l.text, { voice: script.voice, speed: 1.04 });
  const path = `public/audio/vo-${l.id}.wav`;
  await audio.save(path);
  out[l.id] = { path, seconds: audio.audio.length / audio.sampling_rate };
  console.log(l.id, out[l.id].seconds.toFixed(2));
}
writeFileSync("src/voice.json", JSON.stringify(out, null, 1));
