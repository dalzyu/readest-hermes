export interface RepairPromptRequest {
  originalSystemPrompt: string;
  originalUserPrompt: string;
  issue: string;
  orderedFieldIds: string;
}

export interface RepairPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Builds a repair prompt instructing the LLM to retry a failed lookup.
 * The system prompt reminds the model to emit the <lookup_json> sentinel
 * and re-states the required fields in their exact order.
 * The user prompt includes the original request plus a description of the issue.
 */
export function buildRepairPrompt(request: RepairPromptRequest): RepairPromptResult {
  const systemPrompt = `${request.originalSystemPrompt}

The previous response had this issue: ${request.issue}
Retry the same request, preserve the same language requirements.

Required fields (in exact order): ${request.orderedFieldIds}
You must still include the final <lookup_json>...</lookup_json> summary.
Respond with ONLY the requested tagged fields and the final sentinel block.`;

  const userPrompt = `The previous response had the following issue: ${request.issue}

Please retry the original request and provide a complete, valid response.

Original request:
${request.originalUserPrompt}`;

  return { systemPrompt, userPrompt };
}
