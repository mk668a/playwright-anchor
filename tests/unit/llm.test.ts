import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnchorHealError } from '../../src/core/errors.js';
import { LlmHealer, parseProposal } from '../../src/core/llm.js';

const ctx = { original: '#old', snapshot: '- button "Buy" [ref=e2]', attempt: 1 };

const completion = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseProposal', () => {
  it('parses a clean JSON object', () => {
    expect(parseProposal('{"ref": "e2", "reason": "same button"}')).toEqual({
      ref: 'e2',
      selector: undefined,
      reason: 'same button',
    });
  });

  it('strips code fences', () => {
    expect(parseProposal('```json\n{"ref": "e7"}\n```').ref).toBe('e7');
  });

  it('strips <think> blocks from reasoning models', () => {
    const out = parseProposal('<think>e1? no... e3.</think>{"ref": "e3", "reason": "r"}');
    expect(out.ref).toBe('e3');
  });

  it('accepts a direct selector proposal', () => {
    expect(parseProposal('{"selector": "[data-testid=\\"buy\\"]"}').selector).toBe(
      '[data-testid="buy"]',
    );
  });

  it('preserves an explicit null ref (model says nothing matches)', () => {
    expect(parseProposal('{"ref": null, "reason": "no match"}').ref).toBeNull();
  });

  it('falls back to a bare ref mention in non-JSON output', () => {
    expect(parseProposal('I think the element is e12, the submit button.').ref).toBe('e12');
  });

  it('returns a null ref when nothing is extractable', () => {
    expect(parseProposal('no idea, sorry').ref).toBeNull();
  });
});

describe('LlmHealer', () => {
  const healer = () =>
    new LlmHealer({ baseURL: 'http://fake.local/v1/', model: 'test-model', apiKey: 'k' });

  it('POSTs an OpenAI-compatible request and parses the proposal', async () => {
    const fetchMock = vi.fn(async () => completion('{"ref": "e2", "reason": "r"}'));
    vi.stubGlobal('fetch', fetchMock);

    const proposal = await healer().propose(ctx);
    expect(proposal.ref).toBe('e2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://fake.local/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-model');
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain('#old');
    expect(body.messages[1].content).toContain('[ref=e2]');
  });

  it('wraps connection failures in an actionable AnchorHealError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    await expect(healer().propose(ctx)).rejects.toThrow(AnchorHealError);
    await expect(healer().propose(ctx)).rejects.toThrow(/ollama serve/);
  });

  it('throws on non-2xx responses with the status included', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('model not found', { status: 404 })));
    await expect(healer().propose(ctx)).rejects.toThrow(/404/);
  });

  it('throws when the response has no content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('')));
    await expect(healer().propose(ctx)).rejects.toThrow(/no message content/);
  });
});
