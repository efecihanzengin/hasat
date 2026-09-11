import type { ExportFormat } from "@youtube-transcript/core";

export const ALL_FORMATS: readonly ExportFormat[] = [
  "txt",
  "json",
  "csv",
  "srt",
  "vtt",
  "markdown",
] as const;

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  txt: "TXT (.txt)",
  json: "JSON (.json)",
  csv: "CSV (.csv)",
  srt: "SRT (.srt)",
  vtt: "VTT (.vtt)",
  markdown: "Markdown (.md)",
};

export type LanguageOption = {
  code: string;
  label: string;
};

export const POPULAR_LANGUAGES: readonly LanguageOption[] = [
  { code: "auto", label: "Auto / Video Default" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish (Español)" },
  { code: "tr", label: "Turkish (Türkçe)" },
  { code: "de", label: "German (Deutsch)" },
  { code: "fr", label: "French (Français)" },
  { code: "pt", label: "Portuguese (Português)" },
  { code: "it", label: "Italian (Italiano)" },
  { code: "ja", label: "Japanese (日本語)" },
  { code: "ko", label: "Korean (한국어)" },
  { code: "ru", label: "Russian (Русский)" },
  { code: "ar", label: "Arabic (العربية)" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "zh-Hans", label: "Chinese Simplified (简体中文)" },
  { code: "zh-Hant", label: "Chinese Traditional (繁體中文)" },
  { code: "id", label: "Indonesian (Bahasa Indonesia)" },
  { code: "nl", label: "Dutch (Nederlands)" },
  { code: "pl", label: "Polish (Polski)" },
  { code: "uk", label: "Ukrainian (Українська)" },
  { code: "vi", label: "Vietnamese (Tiếng Việt)" },
] as const;

export type PanelViewState =
  | "config"
  | "enumerating"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";
