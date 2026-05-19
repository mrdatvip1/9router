/**
 * kiro-to-openai-thinking-inject.js
 *
 * Inject module: wrap translator KIRO → OPENAI để xử lý tag <thinking>...</thinking>
 * ngay tại tầng provider response. Đây là path mà RooCode thường đi qua khi cấu hình
 * 9router như OpenAI/Ollama-compatible endpoint, nên OPENAI→CLAUDE inject sẽ không chạy.
 *
 * Merge-safe: không sửa kiro-to-openai.js gốc.
 * Chỉ override registry entry bằng cách register SAU kiro-to-openai.js.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { convertKiroToOpenAI } from "./kiro-to-openai.js";
import { normalizeThinkingTagsInChunk } from "./thinking-tag-normalizer.js";

/**
 * Wrapper: convert Kiro event sang OpenAI chunk trước, sau đó tách
 * <thinking>...</thinking> trong delta.content thành delta.reasoning_content.
 *
 * @param {object|string} chunk - Kiro event/chunk gốc
 * @param {object} state - translator state
 * @returns {object[]|object|null} OpenAI chunk(s)
 */
export function convertKiroToOpenAIWithThinkingTags(chunk, state) {
  const converted = convertKiroToOpenAI(chunk, state);
  if (!converted) return converted;

  const convertedChunks = Array.isArray(converted) ? converted : [converted];
  const normalizedChunks = [];

  for (const openaiChunk of convertedChunks) {
    const normalized = normalizeThinkingTagsInChunk(openaiChunk, state);
    normalizedChunks.push(...normalized);
  }

  return normalizedChunks.length === 1 ? normalizedChunks[0] : normalizedChunks;
}

// Override registry entry KIRO → OPENAI.
// File này phải được require SAU kiro-to-openai.js trong ensureInitialized().
register(FORMATS.KIRO, FORMATS.OPENAI, null, convertKiroToOpenAIWithThinkingTags);
