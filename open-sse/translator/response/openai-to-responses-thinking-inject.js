/**
 * openai-to-responses-thinking-inject.js
 *
 * Inject module: wrap translator OPENAI → OPENAI_RESPONSES để xử lý tag <thinking>...</thinking>
 * trong delta.content trước khi gọi translator gốc.
 *
 * Merge-safe: không sửa openai-responses.js gốc.
 * openai-responses.js đã xử lý <think> (DeepSeek style) nhưng không xử lý <thinking> (Kiro/Claude style).
 * Inject này normalize <thinking> → delta.reasoning_content trước khi gọi translator gốc,
 * để openaiToOpenAIResponsesResponse xử lý đúng thành response.reasoning_summary_text.delta events.
 *
 * Import file này ở cuối ensureInitialized() trong translator/index.js,
 * SAU openai-responses.js.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToOpenAIResponsesResponse } from "./openai-responses.js";
import { normalizeThinkingTagsInChunk } from "./thinking-tag-normalizer.js";

/**
 * Wrapper: normalize <thinking> tags rồi gọi openaiToOpenAIResponsesResponse gốc.
 *
 * @param {object} chunk - OpenAI stream chunk
 * @param {object} state - translator state
 * @returns {object[]|null} mảng Responses API events hoặc null
 */
function openaiToResponsesWithThinkingTags(chunk, state) {
  // Normalize <thinking> tags trong delta.content → delta.reasoning_content
  const normalizedChunks = normalizeThinkingTagsInChunk(chunk, state);

  // Gọi translator gốc cho từng chunk đã normalize, collect tất cả events
  const allEvents = [];
  for (const c of normalizedChunks) {
    const result = openaiToOpenAIResponsesResponse(c, state);
    if (!result) continue;
    if (Array.isArray(result)) {
      allEvents.push(...result);
    } else {
      allEvents.push(result);
    }
  }

  return allEvents.length > 0 ? allEvents : null;
}

// Override registry entry OPENAI → OPENAI_RESPONSES
// File này phải được require SAU openai-responses.js trong ensureInitialized().
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToResponsesWithThinkingTags);
