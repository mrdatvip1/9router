import { describe, it, expect } from "vitest";

import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("openaiToOpenAIResponsesRequest", () => {
  it("preserves array system content as Responses API instructions", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-test", {
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: "ROO_SYSTEM_PROMPT" },
          ],
        },
        {
          role: "user",
          content: "hello",
        },
      ],
    }, true);

    expect(result.instructions).toBe("ROO_SYSTEM_PROMPT");
    expect(result.input).toHaveLength(1);
    expect(result.input[0].role).toBe("user");
  });

  it("merges multiple system and developer messages into instructions", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-test", {
      messages: [
        { role: "system", content: "SYSTEM_ONE" },
        {
          role: "developer",
          content: [
            { type: "text", text: "DEVELOPER_ONE" },
            { type: "text", text: "DEVELOPER_TWO" },
          ],
        },
        { role: "system", content: [{ type: "text", text: "SYSTEM_TWO" }] },
        { role: "user", content: "hello" },
      ],
    }, true);

    expect(result.instructions).toBe("SYSTEM_ONE\n\nDEVELOPER_ONE\nDEVELOPER_TWO\n\nSYSTEM_TWO");
    expect(result.input).toHaveLength(1);
    expect(result.input[0].role).toBe("user");
  });
});
