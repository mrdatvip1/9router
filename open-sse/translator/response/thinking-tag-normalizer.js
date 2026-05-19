/**
 * thinking-tag-normalizer.js
 *
 * Utility xử lý tag <thinking>...</thinking> trong delta.content của OpenAI stream chunk.
 * Tách phần nằm trong tag thành delta.reasoning_content để các translator downstream
 * (openai-to-claude, openai-to-responses) có thể render đúng thành thinking block.
 *
 * Merge-safe: file này độc lập, không sửa bất kỳ translator gốc nào.
 * Được dùng bởi inject modules (openai-to-claude-thinking-inject.js, v.v.)
 *
 * Xử lý đúng streaming split:
 *   Chunk 1: "text <thin"   → emit "text", buffer "<thin"
 *   Chunk 2: "king>reason"  → emit reasoning_content "reason"
 *   Chunk 3: "</thinking>"  → đóng tag, emit nothing
 *   Chunk 4: " more text"   → emit content " more text"
 */

// Tag constants
const OPEN_TAG = "<thinking>";
const CLOSE_TAG = "</thinking>";

/**
 * Tìm độ dài lớn nhất của prefix của `tag` mà là suffix của `text`.
 * Dùng để detect partial tag ở cuối chunk.
 *
 * Ví dụ: findPartialSuffix("hello <thin", "<thinking>") → 6 (vì "<thin" là prefix của "<thinking>")
 *
 * @param {string} text
 * @param {string} tag
 * @returns {number} độ dài partial suffix (0 nếu không có)
 */
export function findPartialSuffix(text, tag) {
  // Kiểm tra từ độ dài lớn nhất có thể (tag.length - 1) xuống 1
  const maxLen = Math.min(tag.length - 1, text.length);
  for (let len = maxLen; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

/**
 * Tạo chunk mới từ chunk gốc với delta được thay thế.
 * Giữ nguyên role nếu là chunk đầu tiên (isFirst=true).
 *
 * @param {object} original - OpenAI chunk gốc
 * @param {object} newDelta - delta mới
 * @param {boolean} isFirst - có giữ role không
 * @returns {object} chunk mới
 */
function makeChunk(original, newDelta, isFirst = false) {
  const originalDelta = original.choices[0].delta;
  return {
    ...original,
    choices: [{
      ...original.choices[0],
      delta: {
        // Chỉ giữ role ở chunk đầu tiên của split
        ...(isFirst && originalDelta.role ? { role: originalDelta.role } : {}),
        ...newDelta
      }
    }]
  };
}

/**
 * Normalize tag <thinking>...</thinking> trong một OpenAI stream chunk.
 *
 * Nhận vào một chunk và state (có thể chứa _thinkingTagState từ chunk trước).
 * Trả về mảng các chunks đã được normalize:
 *   - Phần text thường → delta.content
 *   - Phần trong tag   → delta.reasoning_content
 *
 * Nếu chunk không có delta.content hoặc đã có delta.reasoning_content,
 * trả về [chunk] nguyên vẹn.
 *
 * @param {object} chunk - OpenAI stream chunk
 * @param {object} state - translator state (được mutate để track tag state)
 * @returns {object[]} mảng chunks đã normalize
 */
export function normalizeThinkingTagsInChunk(chunk, state) {
  // Không có chunk hoặc không có choices → trả về nguyên
  if (!chunk?.choices?.[0]?.delta) return [chunk];

  const delta = chunk.choices[0].delta;

  // Đã có reasoning_content → không cần xử lý tag
  if (delta.reasoning_content) return [chunk];

  // Không có content text → không cần xử lý
  if (typeof delta.content !== "string") return [chunk];

  // Khởi tạo state tracking cho thinking tag
  if (!state._thinkingTagState) {
    state._thinkingTagState = {
      inTag: false, // đang trong <thinking>...</thinking>
      buf: ""       // buffer cho partial tag ở cuối chunk trước
    };
  }
  const ts = state._thinkingTagState;

  // Prepend buffer từ chunk trước (partial tag chưa hoàn chỉnh)
  let text = ts.buf + delta.content;
  ts.buf = "";

  const resultChunks = [];
  let isFirstChunk = true; // Chunk đầu tiên của split giữ role

  // Xử lý text theo từng đoạn
  while (text.length > 0) {
    if (ts.inTag) {
      // --- Đang trong <thinking> tag ---
      const closeIdx = text.indexOf(CLOSE_TAG);

      if (closeIdx !== -1) {
        // Tìm thấy </thinking> → đóng tag
        const reasoningPart = text.slice(0, closeIdx);
        text = text.slice(closeIdx + CLOSE_TAG.length);
        ts.inTag = false;

        if (reasoningPart) {
          resultChunks.push(makeChunk(chunk, { reasoning_content: reasoningPart }, isFirstChunk));
          isFirstChunk = false;
        }
        // Tiếp tục vòng lặp để xử lý text sau </thinking>
      } else {
        // Không tìm thấy </thinking> trong chunk này
        // Kiểm tra partial close tag ở cuối
        const partialLen = findPartialSuffix(text, CLOSE_TAG);
        if (partialLen > 0) {
          // Có partial close tag → buffer lại, emit phần còn lại là reasoning
          const reasoningPart = text.slice(0, text.length - partialLen);
          ts.buf = text.slice(text.length - partialLen);
          text = "";
          if (reasoningPart) {
            resultChunks.push(makeChunk(chunk, { reasoning_content: reasoningPart }, isFirstChunk));
            isFirstChunk = false;
          }
        } else {
          // Toàn bộ text là reasoning content
          resultChunks.push(makeChunk(chunk, { reasoning_content: text }, isFirstChunk));
          isFirstChunk = false;
          text = "";
        }
      }
    } else {
      // --- Ngoài tag ---
      const openIdx = text.indexOf(OPEN_TAG);

      if (openIdx !== -1) {
        // Tìm thấy <thinking> → mở tag
        const textBefore = text.slice(0, openIdx);
        text = text.slice(openIdx + OPEN_TAG.length);
        ts.inTag = true;

        if (textBefore) {
          resultChunks.push(makeChunk(chunk, { content: textBefore }, isFirstChunk));
          isFirstChunk = false;
        }
        // Tiếp tục vòng lặp để xử lý phần trong tag
      } else {
        // Không tìm thấy <thinking> trong chunk này
        // Kiểm tra partial open tag ở cuối
        const partialLen = findPartialSuffix(text, OPEN_TAG);
        if (partialLen > 0) {
          // Có partial open tag → buffer lại, emit phần còn lại là text
          const textContent = text.slice(0, text.length - partialLen);
          ts.buf = text.slice(text.length - partialLen);
          text = "";
          if (textContent) {
            resultChunks.push(makeChunk(chunk, { content: textContent }, isFirstChunk));
            isFirstChunk = false;
          }
        } else {
          // Toàn bộ text là content thường
          resultChunks.push(makeChunk(chunk, { content: text }, isFirstChunk));
          isFirstChunk = false;
          text = "";
        }
      }
    }
  }

  // Nếu không có chunk nào được tạo (ví dụ content rỗng sau khi strip tag),
  // trả về chunk với delta rỗng để giữ các field khác (finish_reason, usage, v.v.)
  if (resultChunks.length === 0) {
    return [makeChunk(chunk, {}, true)];
  }

  return resultChunks;
}
