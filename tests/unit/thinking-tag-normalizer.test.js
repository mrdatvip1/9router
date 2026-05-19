/**
 * Unit tests cho open-sse/translator/response/thinking-tag-normalizer.js
 *
 * Kiểm tra logic tách <thinking>...</thinking> tags trong delta.content
 * thành delta.reasoning_content, bao gồm xử lý streaming split.
 */

import { describe, it, expect } from "vitest";
import { normalizeThinkingTagsInChunk, findPartialSuffix } from "../../open-sse/translator/response/thinking-tag-normalizer.js";

// Helper: tạo OpenAI stream chunk
function makeChunk(content, extraDelta = {}) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1234567890,
    model: "test-model",
    choices: [{
      index: 0,
      delta: { content, ...extraDelta },
      finish_reason: null
    }]
  };
}

// Helper: lấy delta từ chunk đầu tiên
function delta(chunk) {
  return chunk.choices[0].delta;
}

// ─── findPartialSuffix ────────────────────────────────────────────────────────

describe("findPartialSuffix", () => {
  it("trả về 0 khi không có partial suffix", () => {
    expect(findPartialSuffix("hello world", "<thinking>")).toBe(0);
  });

  it("phát hiện partial open tag ở cuối text", () => {
    // "<thin" là 5 ký tự đầu của "<thinking>"
    expect(findPartialSuffix("hello <thin", "<thinking>")).toBe(5);
  });

  it("phát hiện partial close tag ở cuối text", () => {
    // "</think" là 7 ký tự đầu của "</thinking>"
    expect(findPartialSuffix("reasoning</think", "</thinking>")).toBe(7);
  });

  it("không trả về full tag (chỉ partial)", () => {
    // Full tag không phải partial
    expect(findPartialSuffix("text<thinking>", "<thinking>")).toBe(0);
  });

  it("trả về 0 khi text ngắn hơn tag", () => {
    expect(findPartialSuffix("<", "<thinking>")).toBe(1);
    expect(findPartialSuffix("", "<thinking>")).toBe(0);
  });
});

// ─── normalizeThinkingTagsInChunk: trường hợp không cần xử lý ────────────────

describe("normalizeThinkingTagsInChunk — không cần xử lý", () => {
  it("trả về [chunk] nguyên khi không có <thinking> tag", () => {
    const chunk = makeChunk("Hello world");
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);
    expect(result).toHaveLength(1);
    expect(delta(result[0]).content).toBe("Hello world");
  });

  it("trả về [chunk] nguyên khi đã có reasoning_content", () => {
    const chunk = makeChunk(null, { reasoning_content: "thinking..." });
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);
    expect(result).toHaveLength(1);
    expect(delta(result[0]).reasoning_content).toBe("thinking...");
  });

  it("trả về [chunk] nguyên khi delta không có content", () => {
    const chunk = makeChunk(null, { role: "assistant" });
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);
    expect(result).toHaveLength(1);
  });

  it("trả về [chunk] nguyên khi chunk null", () => {
    const state = {};
    const result = normalizeThinkingTagsInChunk(null, state);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeNull();
  });
});

// ─── normalizeThinkingTagsInChunk: tag trong cùng một chunk ──────────────────

describe("normalizeThinkingTagsInChunk — tag trong cùng một chunk", () => {
  it("tách <thinking>...</thinking> thành reasoning_content", () => {
    const chunk = makeChunk("<thinking>I am thinking</thinking>");
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);

    // Chỉ có reasoning_content, không có content text
    const reasoningChunks = result.filter(c => delta(c).reasoning_content);
    expect(reasoningChunks).toHaveLength(1);
    expect(delta(reasoningChunks[0]).reasoning_content).toBe("I am thinking");
  });

  it("giữ text trước <thinking> tag", () => {
    const chunk = makeChunk("Before <thinking>thinking</thinking>");
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);

    const contentChunks = result.filter(c => delta(c).content);
    const reasoningChunks = result.filter(c => delta(c).reasoning_content);
    expect(delta(contentChunks[0]).content).toBe("Before ");
    expect(delta(reasoningChunks[0]).reasoning_content).toBe("thinking");
  });

  it("giữ text sau </thinking> tag", () => {
    const chunk = makeChunk("<thinking>thinking</thinking> After");
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);

    const reasoningChunks = result.filter(c => delta(c).reasoning_content);
    const contentChunks = result.filter(c => delta(c).content);
    expect(delta(reasoningChunks[0]).reasoning_content).toBe("thinking");
    expect(delta(contentChunks[0]).content).toBe(" After");
  });

  it("giữ text trước và sau tag", () => {
    const chunk = makeChunk("Before <thinking>thinking</thinking> After");
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);

    expect(result.length).toBeGreaterThanOrEqual(3);
    const contents = result.map(c => delta(c).content).filter(Boolean);
    const reasonings = result.map(c => delta(c).reasoning_content).filter(Boolean);
    expect(contents).toContain("Before ");
    expect(contents).toContain(" After");
    expect(reasonings).toContain("thinking");
  });
});

// ─── normalizeThinkingTagsInChunk: streaming split ───────────────────────────

describe("normalizeThinkingTagsInChunk — streaming split qua nhiều chunks", () => {
  it("xử lý <thinking> ở chunk này, </thinking> ở chunk khác", () => {
    const state = {};

    // Chunk 1: mở tag, chưa có close
    const chunk1 = makeChunk("<thinking>start of thinking");
    const result1 = normalizeThinkingTagsInChunk(chunk1, state);
    const r1 = result1.filter(c => delta(c).reasoning_content);
    expect(r1).toHaveLength(1);
    expect(delta(r1[0]).reasoning_content).toBe("start of thinking");
    expect(state._thinkingTagState.inTag).toBe(true);

    // Chunk 2: tiếp tục thinking
    const chunk2 = makeChunk(" more thinking");
    const result2 = normalizeThinkingTagsInChunk(chunk2, state);
    const r2 = result2.filter(c => delta(c).reasoning_content);
    expect(r2).toHaveLength(1);
    expect(delta(r2[0]).reasoning_content).toBe(" more thinking");

    // Chunk 3: đóng tag và có text sau
    const chunk3 = makeChunk("</thinking> Final text");
    const result3 = normalizeThinkingTagsInChunk(chunk3, state);
    expect(state._thinkingTagState.inTag).toBe(false);
    const c3 = result3.filter(c => delta(c).content);
    expect(delta(c3[0]).content).toBe(" Final text");
  });

  it("buffer partial open tag ở cuối chunk", () => {
    const state = {};

    // Chunk 1: text + partial open tag
    const chunk1 = makeChunk("Hello <thin");
    const result1 = normalizeThinkingTagsInChunk(chunk1, state);
    const c1 = result1.filter(c => delta(c).content);
    expect(delta(c1[0]).content).toBe("Hello ");
    // Partial tag được buffer, chưa emit
    expect(state._thinkingTagState.buf).toBe("<thin");
    expect(state._thinkingTagState.inTag).toBe(false);

    // Chunk 2: hoàn thành open tag + reasoning
    const chunk2 = makeChunk("king>I am thinking</thinking>");
    const result2 = normalizeThinkingTagsInChunk(chunk2, state);
    const r2 = result2.filter(c => delta(c).reasoning_content);
    expect(r2).toHaveLength(1);
    expect(delta(r2[0]).reasoning_content).toBe("I am thinking");
    expect(state._thinkingTagState.buf).toBe("");
  });

  it("buffer partial close tag ở cuối chunk", () => {
    const state = {};

    // Chunk 1: mở tag + reasoning + partial close
    const chunk1 = makeChunk("<thinking>reasoning</think");
    const result1 = normalizeThinkingTagsInChunk(chunk1, state);
    const r1 = result1.filter(c => delta(c).reasoning_content);
    expect(r1).toHaveLength(1);
    expect(delta(r1[0]).reasoning_content).toBe("reasoning");
    // Partial close tag được buffer
    expect(state._thinkingTagState.buf).toBe("</think");
    expect(state._thinkingTagState.inTag).toBe(true);

    // Chunk 2: hoàn thành close tag + text sau
    const chunk2 = makeChunk("ing> After text");
    const result2 = normalizeThinkingTagsInChunk(chunk2, state);
    expect(state._thinkingTagState.inTag).toBe(false);
    const c2 = result2.filter(c => delta(c).content);
    expect(delta(c2[0]).content).toBe(" After text");
  });
});

// ─── normalizeThinkingTagsInChunk: edge cases ────────────────────────────────

describe("normalizeThinkingTagsInChunk — edge cases", () => {
  it("xử lý content rỗng sau khi strip tag", () => {
    const chunk = makeChunk("<thinking>only thinking</thinking>");
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);
    // Không có content chunk, chỉ có reasoning
    const contentChunks = result.filter(c => delta(c).content);
    expect(contentChunks).toHaveLength(0);
  });

  it("không ảnh hưởng đến finish_reason trong chunk", () => {
    const chunk = {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 1234567890,
      model: "test-model",
      choices: [{
        index: 0,
        delta: { content: "text" },
        finish_reason: "stop"
      }]
    };
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);
    // finish_reason được giữ nguyên
    expect(result[0].choices[0].finish_reason).toBe("stop");
  });

  it("giữ role: assistant ở chunk đầu tiên của split", () => {
    const chunk = makeChunk("Before <thinking>thinking</thinking>", { role: "assistant" });
    const state = {};
    const result = normalizeThinkingTagsInChunk(chunk, state);
    // Chunk đầu tiên phải có role
    expect(delta(result[0]).role).toBe("assistant");
    // Các chunk sau không có role
    if (result.length > 1) {
      expect(delta(result[1]).role).toBeUndefined();
    }
  });
});
