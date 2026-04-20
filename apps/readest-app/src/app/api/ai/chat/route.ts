import type { InferenceParams } from '@/services/ai/types';
import { buildInferenceOptions } from '@/services/ai/inferenceParams';
import { validateUserAndToken } from '@/utils/access';
import { streamText, createGateway } from 'ai';
import type { ModelMessage } from 'ai';

export async function POST(req: Request): Promise<Response> {
  try {
    const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
    if (!user || !token) {
      return Response.json({ error: 'Not authenticated' }, { status: 403 });
    }

    const { messages, system, apiKey, model, inferenceParams } = (await req.json()) as {
      messages: unknown;
      system?: string;
      apiKey?: string;
      model?: string;
      inferenceParams?: InferenceParams;
    };

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const gatewayApiKey = apiKey || process.env['AI_GATEWAY_API_KEY'];
    if (!gatewayApiKey) {
      return new Response(JSON.stringify({ error: 'API key required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const gateway = createGateway({ apiKey: gatewayApiKey });
    const languageModel = gateway(model || 'google/gemini-2.5-flash-lite');

    const result = streamText({
      model: languageModel,
      system: system || 'You are a helpful assistant.',
      messages: messages as ModelMessage[],
      ...buildInferenceOptions(inferenceParams),
    });

    return result.toTextStreamResponse();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `Chat failed: ${errorMessage}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
