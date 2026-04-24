import { NextResponse } from 'next/server';
import { embed, embedMany, createGateway } from 'ai';
import { validateUserAndToken } from '@/utils/access';
import {
  AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST,
  isAllowedAIGatewayEmbeddingModel,
} from '@/services/ai/capabilities';

export async function POST(req: Request): Promise<Response> {
  try {
    const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
    if (!user || !token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
    }

    const { texts, single, apiKey, model } = await req.json();

    if (model !== undefined && model !== null && typeof model !== 'string') {
      return NextResponse.json({ error: 'Embedding model not allowed' }, { status: 400 });
    }

    const embeddingModelName =
      model || process.env['AI_GATEWAY_EMBEDDING_MODEL'] || AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST[0];

    if (!isAllowedAIGatewayEmbeddingModel(embeddingModelName)) {
      return NextResponse.json({ error: 'Embedding model not allowed' }, { status: 400 });
    }

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: 'Texts array required' }, { status: 400 });
    }

    const gatewayApiKey = apiKey || process.env['AI_GATEWAY_API_KEY'];
    if (!gatewayApiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    const gateway = createGateway({ apiKey: gatewayApiKey });
    const embeddingModel = gateway.embeddingModel(embeddingModelName);

    if (single) {
      const { embedding } = await embed({ model: embeddingModel, value: texts[0] });
      return NextResponse.json({ embedding });
    } else {
      const { embeddings } = await embedMany({ model: embeddingModel, values: texts });
      return NextResponse.json({ embeddings });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Embedding failed: ${errorMessage}` }, { status: 500 });
  }
}
