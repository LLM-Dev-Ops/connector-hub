import { z } from 'zod';

/**
 * LLM completion request schema (canonical format)
 */
export const LLMCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
    content: z.union([
      z.string(),
      z.array(z.object({
        type: z.enum(['text', 'image_url', 'image_base64']),
        text: z.string().optional(),
        image_url: z.object({
          url: z.string(),
          detail: z.enum(['auto', 'low', 'high']).optional(),
        }).optional(),
        image_base64: z.object({
          data: z.string(),
          media_type: z.string(),
        }).optional(),
      })),
    ]),
    name: z.string().optional(),
    function_call: z.object({
      name: z.string(),
      arguments: z.string(),
    }).optional(),
    tool_calls: z.array(z.object({
      id: z.string(),
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        arguments: z.string(),
      }),
    })).optional(),
    tool_call_id: z.string().optional(),
  })),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().positive().optional(),
  stop: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  functions: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()),
  })).optional(),
  tools: z.array(z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.unknown()),
    }),
  })).optional(),
});

export type LLMCompletionRequest = z.infer<typeof LLMCompletionRequestSchema>;

/**
 * LLM completion response schema (canonical format)
 */
export const LLMCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.string(),
  created: z.number(),
  model: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    message: z.object({
      role: z.enum(['assistant']),
      content: z.string().nullable(),
      function_call: z.object({
        name: z.string(),
        arguments: z.string(),
      }).optional(),
      tool_calls: z.array(z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })).optional(),
    }),
    finish_reason: z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
  })),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

export type LLMCompletionResponse = z.infer<typeof LLMCompletionResponseSchema>;

/**
 * LLM stream chunk schema (canonical format)
 */
export const LLMStreamChunkSchema = z.object({
  content: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool']).optional(),
  finish_reason: z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable().optional(),
  function_call: z.object({
    name: z.string().optional(),
    arguments: z.string().optional(),
  }).optional(),
  tool_calls: z.array(z.object({
    index: z.number(),
    id: z.string().optional(),
    type: z.literal('function').optional(),
    function: z.object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    }),
  })).optional(),
});

export type LLMStreamChunk = z.infer<typeof LLMStreamChunkSchema>;

/**
 * LLM error schema (canonical format)
 */
export const LLMErrorSchema = z.object({
  type: z.enum(['authentication', 'rate_limit', 'invalid_request', 'server_error', 'timeout', 'network', 'unknown']),
  message: z.string(),
  code: z.string().optional(),
  status_code: z.number().optional(),
  provider: z.string(),
  retryable: z.boolean(),
  retry_after: z.number().optional(),
  details: z.record(z.unknown()).optional(),
});

export type LLMError = z.infer<typeof LLMErrorSchema>;
