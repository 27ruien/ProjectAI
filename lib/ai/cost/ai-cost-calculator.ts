import type { AIModel, TokenUsage } from "@/types";

const RATE_BY_LEVEL = {
  low: { input: 0.00012, output: 0.00036 },
  medium: { input: 0.00028, output: 0.00084 },
  high: { input: 0.00062, output: 0.00186 },
} as const;

export interface AICostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "CNY";
}

export class AICostCalculator {
  calculate(model: AIModel, usage: TokenUsage): AICostBreakdown {
    const rate = RATE_BY_LEVEL[model.costLevel];
    const inputCost = usage.inputTokens * rate.input;
    const outputCost = usage.outputTokens * rate.output;
    return {
      inputCost: Number(inputCost.toFixed(4)),
      outputCost: Number(outputCost.toFixed(4)),
      totalCost: Number((inputCost + outputCost).toFixed(4)),
      currency: "CNY",
    };
  }
}
