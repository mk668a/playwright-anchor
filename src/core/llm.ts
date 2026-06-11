import { AnchorHealError } from './errors.js';
import type { HealContext, Healer, HealProposal } from './types.js';

export interface LlmOptions {
  /** OpenAI-compatible base URL, e.g. http://127.0.0.1:11434/v1 (Ollama). */
  baseURL: string;
  model: string;
  apiKey?: string;
  /** Per-request timeout in ms. Local first-token latency can be high. */
  requestTimeoutMs?: number;
}

const SYSTEM_PROMPT = `You repair broken element selectors in automated browser tests.
You are given:
1. A selector that no longer matches anything on the page.
2. An accessibility snapshot of the current page. Elements carry reference markers like [ref=e12].

Pick the element the broken selector most likely pointed to, judging by its name, role and the intent implied by the broken selector.

Reply with ONLY a JSON object, no prose, no code fences:
{"ref": "e12", "reason": "one short sentence"}

If you are certain a plain CSS selector is better, you may instead reply:
{"selector": "css-selector-here", "reason": "one short sentence"}

If nothing on the page plausibly matches, reply:
{"ref": null, "reason": "one short sentence"}`;

/**
 * BYO healer over any OpenAI-compatible /chat/completions endpoint
 * (Ollama, llama.cpp server, LM Studio, vLLM, or a hosted key you own).
 * Plain fetch, zero SDK dependencies.
 */
export class LlmHealer implements Healer {
  constructor(private readonly opts: LlmOptions) {}

  describe(): string {
    return this.opts.model;
  }

  async propose(ctx: HealContext): Promise<HealProposal> {
    const url = `${this.opts.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const user =
      `Broken selector: ${ctx.original}\n` +
      (ctx.previousFailure ? `Previous attempt failed: ${ctx.previousFailure}\n` : '') +
      `Page snapshot:\n${ctx.snapshot}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(this.opts.requestTimeoutMs ?? 120_000),
      });
    } catch (err) {
      throw new AnchorHealError(
        ctx.original,
        `could not reach LLM endpoint ${url} — is your local model running? ` +
          `(e.g. \`ollama serve\`) Underlying error: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new AnchorHealError(
        ctx.original,
        `LLM endpoint ${url} responded ${res.status}: ${body}`,
      );
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new AnchorHealError(
        ctx.original,
        `LLM endpoint returned no message content (model: ${this.opts.model}).`,
      );
    }
    return parseProposal(content);
  }
}

/**
 * Tolerant parser for small local models: strips reasoning blocks and code
 * fences, extracts the first JSON object, and falls back to a bare ref match.
 */
export function parseProposal(content: string): HealProposal {
  let text = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```[a-z]*\n?/g, '')
    .replace(/```/g, '')
    .trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const ref = typeof obj.ref === 'string' ? obj.ref : obj.ref === null ? null : undefined;
      const selector = typeof obj.selector === 'string' ? obj.selector : undefined;
      const reason = typeof obj.reason === 'string' ? obj.reason : undefined;
      if (ref !== undefined || selector !== undefined) {
        return { ref, selector, reason };
      }
    } catch {
      // fall through to the regex fallback
    }
  }

  const refMatch = text.match(/\b(e\d+)\b/);
  if (refMatch) {
    return { ref: refMatch[1], reason: 'extracted from non-JSON model output' };
  }
  return { ref: null, reason: 'model output was not parseable' };
}
