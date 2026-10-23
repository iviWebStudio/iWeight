import OpenAI from 'openai';
import { ApiError } from '../errors.js';

/** A function tool as sent to the model. */
export interface ToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
}

/** Input items in Responses API form (kept loose: they are passed through verbatim). */
export type InputItem =
  | { role: 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string; id?: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | Record<string, unknown>;

export interface ModelRequest {
  model: string;
  instructions: string;
  input: InputItem[];
  tools: ToolDefinition[];
  /** 'none' forces a text answer (used after the tool-iteration limit). */
  toolChoice?: 'auto' | 'none';
  maxOutputTokens?: number;
}

export interface FunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ModelResult {
  text: string;
  functionCalls: FunctionCall[];
  /** Output items to replay as input on the next iteration. */
  replay: InputItem[];
  usage: { inputTokens: number; outputTokens: number };
}

/** The seam tests replace with a scripted fake. */
export interface ModelClient {
  respond(req: ModelRequest): Promise<ModelResult>;
}

export function openAIModelClient(apiKey: string, timeoutMs: number): ModelClient {
  // The SDK retries 408/409/429/5xx and connection errors with exponential backoff.
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 2 });
  return {
    async respond(req) {
      try {
        const res = await client.responses.create({
          model: req.model,
          instructions: req.instructions,
          input: req.input as OpenAI.Responses.ResponseInput,
          tools: req.tools,
          tool_choice: req.toolChoice ?? 'auto',
          parallel_tool_calls: true,
          store: false,
          ...(req.maxOutputTokens ? { max_output_tokens: req.maxOutputTokens } : {}),
        });
        const functionCalls: FunctionCall[] = [];
        const replay: InputItem[] = [];
        for (const item of res.output) {
          if (item.type === 'function_call') {
            functionCalls.push({
              callId: item.call_id,
              name: item.name,
              arguments: item.arguments,
            });
            replay.push({
              type: 'function_call',
              call_id: item.call_id,
              name: item.name,
              arguments: item.arguments,
            });
          }
        }
        return {
          text: res.output_text ?? '',
          functionCalls,
          replay,
          usage: {
            inputTokens: res.usage?.input_tokens ?? 0,
            outputTokens: res.usage?.output_tokens ?? 0,
          },
        };
      } catch (e) {
        throw mapOpenAIError(e);
      }
    },
  };
}

export function mapOpenAIError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof OpenAI.APIConnectionTimeoutError)
    return new ApiError(503, 'AI_UNAVAILABLE', 'The AI service timed out, try again', {
      reason: 'timeout',
    });
  if (e instanceof OpenAI.APIConnectionError)
    return new ApiError(503, 'AI_UNAVAILABLE', 'The AI service is unreachable, try again', {
      reason: 'connection',
    });
  if (e instanceof OpenAI.APIError) {
    const status = e.status ?? 0;
    if (status === 429)
      return new ApiError(503, 'AI_UNAVAILABLE', 'The AI service is busy, try again shortly', {
        reason: 'rate_limited',
      });
    if (status === 401 || status === 403)
      return new ApiError(
        503,
        'AI_NOT_CONFIGURED',
        'The AI service rejected the server credentials',
        { reason: 'auth' },
      );
    if (status === 404)
      return new ApiError(
        503,
        'AI_NOT_CONFIGURED',
        'The configured model is not available to this account',
        { reason: 'model_unavailable' },
      );
    if (status === 400)
      return new ApiError(502, 'AI_UNAVAILABLE', 'The AI service rejected the request', {
        reason: 'bad_request',
      });
    return new ApiError(503, 'AI_UNAVAILABLE', 'The AI service failed, try again', {
      reason: `status_${status}`,
    });
  }
  return new ApiError(503, 'AI_UNAVAILABLE', 'The AI service failed, try again', {
    reason: 'unknown',
  });
}
