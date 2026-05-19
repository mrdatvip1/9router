/**
 * openai-to-claude-thinking-inject.js
 *
 * Inject module: wrap translator OPENAI → CLAUDE để xử lý tag <thinking>...</thinking>
 * trong delta.content trước khi gọi translator gốc.
 *
 * Merge-safe: không sửa openai-to-claude.js gốc.
 * Chỉ override registry entry bằng cách register SAU openai-to-claude.js.
 * Import file này ở cuối ensureInitialized() trong translator/index.js.
 *
 * Tại sao cần inject này:
 *   Khi Kiro model output thinking dưới dạng text thường có tag <thinking>...</thinking>
 *   trong assistantResponseEvent.content, 9router đưa vào delta.content.
 *   openai-to-claude.js chỉ xử lý delta.reasoning_content, không xử lý tag trong content.
 *   Kết quả: RooCode nhận text thường thay vì Claude thinking block.
 *
 *   Inject này tách <thinking>...</thinking> ra khỏi delta.content,
 *   chuyển thành delta.reasoning_content trước khi gọi translator gốc.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToClaudeResponse } from "./openai-to-claude.js";
import { normalizeThinkingTagsInChunk } from "./thinking-tag-normalizer.js";

/**
 * Wrapper: normalize <thinking> tags rồi gọi openaiToClaudeResponse gốc.
 *
 * @param {object} chunk - OpenAI stream chunk
 * @param {object} state - translator state
 * @returns {object[]|null} mảng Claude SSE events hoặc null
 */
function openaiToClaudeWithThinkingTags(chunk, state) {
  // Normalize <thinking> tags trong delta.content → delta.reasoning_content
  const normalizedChunks = normalizeThinkingTagsInChunk(chunk, state);

  // Gọi translator gốc cho từng chunk đã normalize
  const allResults = [];
  for (const c of normalizedChunks) {
    const result = openaiToClaudeResponse(c, state);
    if (!result) continue;
    if (Array.isArray(result)) {
      allResults.push(...result);
    } else {
      allResults.push(result);
    }
  }

  return allResults.length > 0 ? allResults : null;
}

// Override registry entry OPENAI → CLAUDE
// register() dùng Map.set() nên register sau sẽ override register trước.
// File này phải được require SAU openai-to-claude.js trong ensureInitialized().
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeWithThinkingTags);
