export interface RepairPromptRequest {
  originalUserPrompt: string;
  issue: string;
}

export interface RepairPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Builds a repair prompt instructing the LLM to retry a failed lookup.
 * The system prompt reminds the model to emit the <lookup_json> sentinel.
 * The user prompt includes the original request plus a description of the issue.
 */
export function buildRepairPrompt(request: RepairPromptRequest): RepairPromptResult {
  const systemPrompt = `You are a literary translation assistant retrying a previous response that had an issue.
Produce the corrected output and wrap all field values in a final JSON summary using the <lookup_json> sentinel:
<lookup_json>{"fieldName":"value",...}</lookup_json>
Respond with ONLY the tagged fields followed by the sentinel. Do not add preamble or extra commentary.`;

  const userPrompt = `The previous response had the following issue: ${request.issue}

Please retry the original request and provide a complete, valid response.

Original request:
${request.originalUserPrompt}`;

  return { systemPrompt, userPrompt };
}
