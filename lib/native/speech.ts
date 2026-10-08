import { hasPlugin } from "./runtime";

/**
 * Native speech-to-text for Plan with Zest (iOS Speech framework / Android SpeechRecognizer).
 * The app WebViews don't provide a working Web Speech API, so the apps use the system recogniser and the
 * web/PWA keeps the browser's. Typing always remains available.
 */
export type NativeSpeechStart = "started" | "denied" | "unavailable";

let stopListening: (() => Promise<void>) | null = null;

export function hasNativeSpeech() {
  return hasPlugin("SpeechRecognition");
}

/**
 * Starts listening. `onText` receives the transcript heard so far; `onEnd` fires once when listening stops
 * (by the person, after silence, or on an error).
 */
export async function startNativeSpeech(language: string, onText: (text: string) => void, onEnd: () => void): Promise<NativeSpeechStart> {
  const { SpeechRecognition } = await import("@capgo/capacitor-speech-recognition");
  try {
    if (!(await SpeechRecognition.available()).available) return "unavailable";
    let permission = (await SpeechRecognition.checkPermissions()).speechRecognition;
    if (permission !== "granted") permission = (await SpeechRecognition.requestPermissions()).speechRecognition;
    if (permission !== "granted") return "denied";
  } catch {
    return "unavailable";
  }

  await SpeechRecognition.removeAllListeners();
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearInterval(poll);
    stopListening = null;
    SpeechRecognition.removeAllListeners().catch(() => undefined);
    onEnd();
  };
  // Safety net: whatever way the recogniser stops, the button never stays stuck on "Stop listening".
  const poll = setInterval(() => {
    SpeechRecognition.isListening()
      .then(({ listening }) => { if (!listening) finish(); })
      .catch(finish);
  }, 2000);
  await SpeechRecognition.addListener("partialResults", (event) => {
    const heard = (event.accumulatedText || event.matches?.[0] || "").trim();
    if (heard) onText(heard);
  });
  await SpeechRecognition.addListener("listeningState", (event) => {
    if (event.status === "stopped" || event.state === "stopped") finish();
  });
  await SpeechRecognition.addListener("error", finish);
  stopListening = async () => {
    await SpeechRecognition.stop().catch(() => undefined);
    finish();
  };
  // With partialResults the call resolves as soon as listening starts; text arrives through "partialResults".
  SpeechRecognition.start({ language, partialResults: true, popup: false, maxResults: 1, addPunctuation: true }).catch(finish);
  return "started";
}

export async function stopNativeSpeech() {
  await stopListening?.();
}
