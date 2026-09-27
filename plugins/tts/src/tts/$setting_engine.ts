export default {
    type: "enum",
    options: ["gemini", "google"],
    env: "TTS_ENGINE",
    default: "gemini",
    title: "Default speech synthesis engine",
    description: "Backend used by tts.speak when no explicit engine is given. 'gemini' calls the Gemini TTS models (expressive delivery, style prompts, one pass without ffmpeg); 'google' calls classic Google Cloud Chirp voices over OAuth.",
};
