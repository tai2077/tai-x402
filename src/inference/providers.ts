/**
 * TAI-x402 Inference Providers
 *
 * Supports multiple inference backends:
 * - DeepSeek (deepseek.com)
 * - Tongyi Qianwen (dashscope.aliyuncs.com)
 * - OpenAI
 * - Anthropic
 * - Any OpenAI-compatible endpoint
 */

import type {
  ChatMessage,
  InferenceOptions,
  InferenceResponse,
  InferenceToolCall,
  TokenUsage,
  InferenceToolDefinition,
} from "../types.js";
import { ResilientHttpClient } from "../conway/http-client.js";

const INFERENCE_TIMEOUT_MS = 120_000;

export interface ProviderConfig {
  name: string;
  apiUrl: string;
  apiKey: string;
  defaultModel: string;
  maxTokens?: number;
}

export interface InferenceProviders {
  deepseek?: ProviderConfig;
  tongyi?: ProviderConfig;
  openai?: ProviderConfig;
  anthropic?: ProviderConfig;
  custom?: ProviderConfig;
}

const DEFAULT_PROVIDERS: Record<string, Partial<ProviderConfig>> = {
  deepseek: {
    name: "deepseek",
    apiUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  tongyi: {
    name: "tongyi",
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    defaultModel: "qwen-turbo",
  },
  openai: {
    name: "openai",
    apiUrl: "https://api.openai.com",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    name: "anthropic",
    apiUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-20241022",
  },
};

export function createMultiProviderClient(providers: InferenceProviders) {
  const httpClient = new ResilientHttpClient({
    baseTimeout: INFERENCE_TIMEOUT_MS,
    retryableStatuses: [429, 500, 502, 503, 504],
  });

  // Determine primary provider (first available)
  const primaryProvider = providers.deepseek || providers.tongyi || providers.openai || providers.anthropic || providers.custom;
  if (!primaryProvider) {
    throw new Error("No inference provider configured");
  }

  let currentProvider = primaryProvider;
  let currentModel = primaryProvider.defaultModel;
  let maxTokens = primaryProvider.maxTokens || 4096;

  const chat = async (
    messages: ChatMessage[],
    opts?: InferenceOptions,
  ): Promise<InferenceResponse> => {
    const model = opts?.model || currentModel;
    const provider = resolveProvider(model, providers) || currentProvider;

    if (provider.name === "anthropic") {
      return chatViaAnthropic({
        model,
        tokenLimit: opts?.maxTokens || maxTokens,
        messages,
        tools: opts?.tools,
        temperature: opts?.temperature,
        apiKey: provider.apiKey,
        httpClient,
      });
    }

    return chatViaOpenAiCompatible({
      model,
      messages,
      tools: opts?.tools,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens || maxTokens,
      apiUrl: provider.apiUrl,
      apiKey: provider.apiKey,
      httpClient,
    });
  };

  const setLowComputeMode = (enabled: boolean): void => {
    if (enabled) {
      // Switch to cheapest available provider
      if (providers.deepseek) {
        currentProvider = providers.deepseek;
        currentModel = "deepseek-chat";
      } else if (providers.tongyi) {
        currentProvider = providers.tongyi;
        currentModel = "qwen-turbo";
      }
      maxTokens = 2048;
    } else {
      currentProvider = primaryProvider;
      currentModel = primaryProvider.defaultModel;
      maxTokens = primaryProvider.maxTokens || 4096;
    }
  };

  const getDefaultModel = (): string => currentModel;

  return {
    chat,
    setLowComputeMode,
    getDefaultModel,
  };
}

function resolveProvider(model: string, providers: InferenceProviders): ProviderConfig | null {
  const lowerModel = model.toLowerCase();
  
  if (lowerModel.includes("deepseek") && providers.deepseek) {
    return providers.deepseek;
  }
  if ((lowerModel.includes("qwen") || lowerModel.includes("tongyi")) && providers.tongyi) {
    return providers.tongyi;
  }
  if (lowerModel.includes("claude") && providers.anthropic) {
    return providers.anthropic;
  }
  if ((lowerModel.includes("gpt") || lowerModel.includes("o1") || lowerModel.includes("o3")) && providers.openai) {
    return providers.openai;
  }
  
  return null;
}

async function chatViaOpenAiCompatible(params: {
  model: string;
  messages: ChatMessage[];
  tools?: InferenceToolDefinition[];
  temperature?: number;
  maxTokens: number;
  apiUrl: string;
  apiKey: string;
  httpClient: ResilientHttpClient;
}): Promise<InferenceResponse> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages.map(formatMessage),
    max_tokens: params.maxTokens,
    stream: false,
  };

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
    body.tool_choice = "auto";
  }

  const resp = await params.httpClient.request(`${params.apiUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    timeout: INFERENCE_TIMEOUT_MS,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Inference error: ${resp.status}: ${text}`);
  }

  const data = await resp.json() as any;
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error("No completion choice returned from inference");
  }

  const message = choice.message;
  const usage: TokenUsage = {
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
    totalTokens: data.usage?.total_tokens || 0,
  };

  const toolCalls: InferenceToolCall[] | undefined =
    message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

  return {
    id: data.id || "",
    model: data.model || params.model,
    message: {
      role: message.role,
      content: message.content || "",
      tool_calls: toolCalls,
    },
    toolCalls,
    usage,
    finishReason: choice.finish_reason || "stop",
  };
}

async function chatViaAnthropic(params: {
  model: string;
  tokenLimit: number;
  messages: ChatMessage[];
  tools?: InferenceToolDefinition[];
  temperature?: number;
  apiKey: string;
  httpClient: ResilientHttpClient;
}): Promise<InferenceResponse> {
  // Extract system message
  let systemPrompt = "";
  const nonSystemMessages: ChatMessage[] = [];
  
  for (const msg of params.messages) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n" : "") + msg.content;
    } else {
      nonSystemMessages.push(msg);
    }
  }

  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.tokenLimit,
    messages: nonSystemMessages.map(msg => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
    })),
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const resp = await params.httpClient.request("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    timeout: INFERENCE_TIMEOUT_MS,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic error: ${resp.status}: ${text}`);
  }

  const data = await resp.json() as any;
  
  let content = "";
  const toolCalls: InferenceToolCall[] = [];

  for (const block of data.content || []) {
    if (block.type === "text") {
      content += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  return {
    id: data.id || "",
    model: data.model || params.model,
    message: {
      role: "assistant",
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      promptTokens: data.usage?.input_tokens || 0,
      completionTokens: data.usage?.output_tokens || 0,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
    finishReason: data.stop_reason || "stop",
  };
}

function formatMessage(msg: ChatMessage): Record<string, unknown> {
  const formatted: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };

  if (msg.name) formatted.name = msg.name;
  if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;

  return formatted;
}
