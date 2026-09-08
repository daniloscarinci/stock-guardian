/**
 * The loop, with the network replaced.
 *
 * The SDK is mocked rather than the module above it, so `client.ts` runs for
 * real: the assertion that no key constructs no client is only worth making
 * against the code that would have constructed one. Nothing here reaches the
 * API, and the API key in every test is a string nobody could bill.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type * as AnthropicSdk from '@anthropic-ai/sdk';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createCategoriesRepository } from '../../repositories/categories.repository';
import { createContactsRepository } from '../../repositories/contacts.repository';
import { createCatalogRepository } from '../../repositories/catalog.repository';
import { MAX_REQUESTS, cacheStats, converse, systemPrompt, thinkingFor, type AiOptions } from './converse';
import type { AiDeps } from './tools';

const mocks = vi.hoisted(() => ({
  create: vi.fn<(params: unknown) => Promise<unknown>>(),
  constructed: vi.fn<(options: unknown) => void>(),
  /**
   * Each request body, cloned at the moment it was sent.
   *
   * `converse` keeps appending to the one `messages` array, which is correct -
   * the SDK serializes it there and then - but it means the recorded argument
   * is the array as it ended, not as it was sent. So each body is copied.
   */
  sent: [] as unknown[],
}));

/*
 * The real error classes are kept as statics, because `converse` narrows with
 * `instanceof` and a lookalike class would make every one of those branches
 * pass for the wrong reason.
 */
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof AnthropicSdk>();
  class MockAnthropic {
    messages = {
      create: (params: unknown): Promise<unknown> => {
        mocks.sent.push(structuredClone(params));
        return mocks.create(params);
      },
    };
    constructor(options: unknown) {
      mocks.constructed(options);
    }
    static APIError = actual.APIError;
    static APIConnectionError = actual.APIConnectionError;
    static AuthenticationError = actual.AuthenticationError;
    static RateLimitError = actual.RateLimitError;
  }
  return { ...actual, default: MockAnthropic };
});

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

const OPTIONS: AiOptions = { apiKey: 'sk-ant-not-a-real-key', model: 'claude-opus-5' };

/** A reply from the API, with only the parts that matter spelled out. */
function reply(overrides: Record<string, unknown>): unknown {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...overrides,
  };
}

const text = (value: string): unknown => ({ type: 'text', text: value });

const toolUse = (id: string, name: string, input: Record<string, unknown>): unknown => ({
  type: 'tool_use',
  id,
  name,
  input,
});

/** The request body of the nth call, as it was at the moment it was sent. */
function request(index: number): Anthropic.MessageCreateParamsNonStreaming {
  const params = mocks.sent[index];
  expect(params, `no request ${String(index)}`).toBeDefined();
  return params as Anthropic.MessageCreateParamsNonStreaming;
}

describe('converse', () => {
  let db: SqlDriver;
  let deps: AiDeps;
  let feijaoId: string;

  beforeEach(async () => {
    mocks.create.mockReset();
    mocks.constructed.mockReset();
    mocks.sent.length = 0;

    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);

    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    const catalog = createCatalogRepository(db);
    const feijao = await items.create({
      name: 'Feijão Preto', quantity: 4, unit: 'kg', minimumQuantity: 10, categoryId: 'food',
    });
    feijaoId = feijao.id;

    deps = {
      items, locations, categories, contacts, catalog,
      context: CONTEXT, language: 'pt-BR', trackedCategoryIds: [], dismissedItemIds: [],
    };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  describe('with no key', () => {
    /*
     * The default state of this application: assistant never opened, no key
     * ever pasted. Nothing may be constructed and nothing may be addressed
     * anywhere - which is the promise `docs/OFFLINE.md` makes on behalf of
     * every install that leaves the assistant alone.
     */
    it('constructs nothing and sends nothing', async () => {
      const outcome = await converse(deps, { ...OPTIONS, apiKey: '' }, 'quanto arroz eu tenho?');

      expect(outcome).toEqual({ kind: 'failed', reason: 'noKey', detail: null });
      expect(mocks.constructed).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('treats a key of spaces as no key', async () => {
      const outcome = await converse(deps, { ...OPTIONS, apiKey: '   ' }, 'oi');

      expect(outcome).toMatchObject({ kind: 'failed', reason: 'noKey' });
      expect(mocks.constructed).not.toHaveBeenCalled();
    });
  });

  describe('the request', () => {
    beforeEach(() => {
      mocks.create.mockResolvedValue(reply({ content: [text('4 kg.')] }));
    });

    it('waives the SDK browser guard and sends the header the API needs with it', async () => {
      await converse(deps, OPTIONS, 'oi');

      expect(mocks.constructed).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-ant-not-a-real-key',
          dangerouslyAllowBrowser: true,
          defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
        }),
      );
    });

    it('sends the question and the tools, and no inventory', async () => {
      await converse(deps, OPTIONS, 'quanto feijão eu tenho?');
      const sent = request(0);

      expect(sent.messages).toEqual([{ role: 'user', content: 'quanto feijão eu tenho?' }]);
      expect(sent.model).toBe('claude-opus-5');
      expect(sent.max_tokens).toBe(16000);
      expect(sent.thinking).toEqual({ type: 'adaptive' });
      expect(sent.output_config).toEqual({ effort: 'high' });
      expect(JSON.stringify(sent.messages)).not.toContain('Feijão Preto');
    });

    it('offers the same tools every time, so the cached prefix stays put', async () => {
      await converse(deps, OPTIONS, 'oi');
      await converse(deps, OPTIONS, 'tudo bem?');
      expect(JSON.stringify(request(0).tools)).toBe(JSON.stringify(request(1).tools));
    });
  });

  describe('the system prompt', () => {
    it("names the day and the user's language, and stays short", () => {
      const prompt = systemPrompt('pt-BR', '2026-09-07');
      expect(prompt).toContain('2026-09-07');
      expect(prompt).toContain('Brazilian Portuguese');
      expect(prompt).toMatch(/do not write/i);
      // Over-prescription costs this model quality. Four paragraphs is the cap.
      expect(prompt.split('\n\n')).toHaveLength(4);
    });

    it('follows the interface language rather than a fixed one', () => {
      expect(systemPrompt('es', '2026-09-07')).toContain('Spanish');
      expect(systemPrompt('en', '2026-09-07')).toContain('English');
    });
  });

  describe('ending', () => {
    it('stops on a stop reason that is not tool_use', async () => {
      mocks.create.mockResolvedValue(
        reply({ stop_reason: 'end_turn', content: [text('Você tem 4 kg de feijão.')] }),
      );

      const outcome = await converse(deps, OPTIONS, 'quanto feijão?');

      expect(outcome).toEqual({
        kind: 'answer',
        text: 'Você tem 4 kg de feijão.',
        proposals: [],
        requests: 1,
      });
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it('stops on max_tokens too, rather than treating it as more work', async () => {
      mocks.create.mockResolvedValue(reply({ stop_reason: 'max_tokens', content: [text('Voc')] }));

      expect(await converse(deps, OPTIONS, 'oi')).toMatchObject({ kind: 'answer', requests: 1 });
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it('reads the answer out of the text blocks and leaves the thinking alone', async () => {
      mocks.create.mockResolvedValue(
        reply({
          content: [
            { type: 'thinking', thinking: 'internal', signature: 'sig' },
            text('Quatro quilos.'),
          ],
        }),
      );

      expect(await converse(deps, OPTIONS, 'oi')).toMatchObject({ text: 'Quatro quilos.' });
    });

    /*
     * A cap that quietly extends itself is not a cap, and every lap is billed
     * to the person who pasted the key. So it is reported.
     */
    it('reports hitting the turn cap instead of looping forever', async () => {
      mocks.create.mockResolvedValue(
        reply({
          stop_reason: 'tool_use',
          content: [toolUse('t1', 'find_item', { name: 'feijao' })],
        }),
      );

      const outcome = await converse(deps, OPTIONS, 'e aí?');

      expect(outcome).toMatchObject({ kind: 'exhausted', requests: MAX_REQUESTS });
      expect(mocks.create).toHaveBeenCalledTimes(MAX_REQUESTS);
    });
  });

  describe('tool use', () => {
    it('runs what it is asked for and returns every result in ONE user message', async () => {
      mocks.create
        .mockResolvedValueOnce(
          reply({
            stop_reason: 'tool_use',
            content: [
              toolUse('t1', 'find_item', { name: 'feijao' }),
              toolUse('t2', 'preparedness_score', {}),
            ],
          }),
        )
        .mockResolvedValueOnce(reply({ content: [text('4 kg, e a sua pontuação é baixa.')] }));

      const outcome = await converse(deps, OPTIONS, 'feijão e pontuação?');
      expect(outcome).toMatchObject({ kind: 'answer', requests: 2 });

      const second = request(1);
      expect(second.messages).toHaveLength(3);
      expect(second.messages[1]?.role).toBe('assistant');

      const results = second.messages[2];
      expect(results?.role).toBe('user');
      // Both results in the one message. Splitting them teaches the model to
      // stop asking for tools in parallel.
      expect(Array.isArray(results?.content)).toBe(true);
      const blocks = results?.content as { type: string; tool_use_id: string }[];
      expect(blocks.map((block) => block.type)).toEqual(['tool_result', 'tool_result']);
      expect(blocks.map((block) => block.tool_use_id)).toEqual(['t1', 't2']);
    });

    it('sends the row it read, and only that row', async () => {
      mocks.create
        .mockResolvedValueOnce(
          reply({
            stop_reason: 'tool_use',
            content: [toolUse('t1', 'find_item', { name: 'feijao' })],
          }),
        )
        .mockResolvedValueOnce(reply({ content: [text('4 kg.')] }));

      await converse(deps, OPTIONS, 'quanto feijão?');
      const blocks = request(1).messages[2]?.content as { content: string }[];
      expect(blocks[0]?.content).toContain('Feijão Preto');
    });

    it('marks a failed tool as an error rather than dropping the result', async () => {
      mocks.create
        .mockResolvedValueOnce(
          reply({ stop_reason: 'tool_use', content: [toolUse('t1', 'no_such_tool', {})] }),
        )
        .mockResolvedValueOnce(reply({ content: [text('Não consegui.')] }));

      await converse(deps, OPTIONS, 'oi');
      const blocks = request(1).messages[2]?.content as { is_error?: boolean }[];
      expect(blocks[0]?.is_error).toBe(true);
    });

    it('collects a proposal, writes nothing, and carries on answering', async () => {
      const exec = vi.spyOn(db, 'exec');
      const transaction = vi.spyOn(db, 'transaction');

      mocks.create
        .mockResolvedValueOnce(
          reply({
            stop_reason: 'tool_use',
            content: [
              toolUse('t1', 'adjust_quantity', {
                item: 'feijao', amount: 5, direction: 'up', transaction: 'purchase',
              }),
            ],
          }),
        )
        .mockResolvedValueOnce(reply({ content: [text('Propus somar 5 kg de feijão.')] }));

      const outcome = await converse(deps, OPTIONS, 'comprei 5 kg de feijão');

      expect(outcome).toMatchObject({ kind: 'answer', text: 'Propus somar 5 kg de feijão.' });
      if (outcome.kind !== 'answer') return;
      expect(outcome.proposals).toHaveLength(1);
      expect(outcome.proposals[0]).toMatchObject({
        kind: 'ADJUST', delta: 5, after: 9, certainty: 'assumed',
      });

      expect(transaction).not.toHaveBeenCalled();
      expect(
        exec.mock.calls.filter(([sql]) => /^\s*(?:insert|update|delete)/i.test(String(sql))),
      ).toHaveLength(0);
      expect((await deps.items.getById(feijaoId))?.quantity).toBe(4);
    });

    it('keeps the proposals it gathered when the cap is hit', async () => {
      mocks.create.mockResolvedValue(
        reply({
          stop_reason: 'tool_use',
          content: [toolUse('t1', 'create_item', { name: 'quinoa' })],
        }),
      );

      const outcome = await converse(deps, OPTIONS, 'adiciona quinoa');
      expect(outcome).toMatchObject({ kind: 'exhausted' });
      if (outcome.kind !== 'exhausted') return;
      expect(outcome.proposals).toHaveLength(MAX_REQUESTS);
      expect((await deps.items.list(CONTEXT, { filters: { search: 'quinoa' } })).rows).toHaveLength(0);
    });
  });

  describe('refusal', () => {
    /*
     * Checked before the content is read. A refusal's content is not an answer
     * to the question, and reporting it as one would put words in the user's
     * interface that nobody meant them to read.
     */
    it('reports the refusal rather than the text beside it', async () => {
      mocks.create.mockResolvedValue(
        reply({
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined' },
          content: [text('this should never be read')],
        }),
      );

      expect(await converse(deps, OPTIONS, 'faça algo estranho')).toEqual({
        kind: 'refused',
        category: 'cyber',
        explanation: 'declined',
      });
    });

    it('survives a refusal with no details attached', async () => {
      mocks.create.mockResolvedValue(reply({ stop_reason: 'refusal', stop_details: null }));

      expect(await converse(deps, OPTIONS, 'oi')).toEqual({
        kind: 'refused', category: null, explanation: null,
      });
    });
  });

  describe('failure', () => {
    /*
     * The distinctions are what the interface needs: a refused key is the
     * user's to fix, a rate limit is worth waiting out, and a connection error
     * means the phone is doing what this application was built to keep doing.
     */
    it('surfaces a refused key as a clear failure, not an unhandled rejection', async () => {
      mocks.create.mockRejectedValue(
        new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()),
      );

      const outcome = await converse(deps, OPTIONS, 'oi');
      expect(outcome).toMatchObject({ kind: 'failed', reason: 'auth' });
      if (outcome.kind !== 'failed') return;
      expect(outcome.detail).toContain('invalid x-api-key');
    });

    it('separates a rate limit from a bad key', async () => {
      mocks.create.mockRejectedValue(
        new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()),
      );
      expect(await converse(deps, OPTIONS, 'oi')).toMatchObject({
        kind: 'failed', reason: 'rateLimit',
      });
    });

    it('separates being offline from being refused', async () => {
      mocks.create.mockRejectedValue(new Anthropic.APIConnectionError({ message: 'no route' }));
      expect(await converse(deps, OPTIONS, 'oi')).toMatchObject({
        kind: 'failed', reason: 'offline',
      });
    });

    it('reports any other API error rather than throwing it at the caller', async () => {
      mocks.create.mockRejectedValue(
        new Anthropic.APIError(500, undefined, 'upstream exploded', new Headers()),
      );
      expect(await converse(deps, OPTIONS, 'oi')).toMatchObject({ kind: 'failed', reason: 'api' });
    });

    it('reports a failure that is not the API at all', async () => {
      mocks.create.mockRejectedValue(new TypeError('fetch is not defined'));
      expect(await converse(deps, OPTIONS, 'oi')).toMatchObject({ kind: 'failed', reason: 'api' });
    });

    it('proposes nothing when the turn failed', async () => {
      mocks.create.mockRejectedValue(
        new Anthropic.AuthenticationError(401, undefined, 'nope', new Headers()),
      );
      const outcome = await converse(deps, OPTIONS, 'comprei 5 kg de feijão');
      expect(outcome).not.toHaveProperty('proposals');
      expect((await deps.items.getById(feijaoId))?.quantity).toBe(4);
    });
  });
});

describe('the parameters each model will accept', () => {
  // These are not interchangeable and the wrong pair is a 400, not a worse
  // answer - so the branch is pinned rather than trusted.
  it('sends Haiku the older thinking form and no effort at all', () => {
    const params = thinkingFor('claude-haiku-4-5');
    expect(params).toEqual({ thinking: { type: 'enabled', budget_tokens: 4000 } });
    // `output_config.effort` ERRORS on Haiku 4.5. Its absence is the assertion.
    expect(params).not.toHaveProperty('output_config');
  });

  it('sends Opus adaptive thinking and an effort', () => {
    expect(thinkingFor('claude-opus-5')).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
  });

  it('never sends budget_tokens to a model that rejects it', () => {
    for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8']) {
      expect(JSON.stringify(thinkingFor(model))).not.toContain('budget_tokens');
    }
  });

  it('matches the family, so a future haiku needs no change here', () => {
    expect(thinkingFor('claude-haiku-5')).toHaveProperty('thinking.budget_tokens');
  });

  it('keeps the budget under max_tokens, as the API requires', () => {
    const params = thinkingFor('claude-haiku-4-5') as {
      thinking: { budget_tokens: number };
    };
    expect(params.thinking.budget_tokens).toBeLessThan(16000);
    expect(params.thinking.budget_tokens).toBeGreaterThanOrEqual(1024);
  });
});

describe('cacheStats', () => {
  // Zero reads across a turn is how a prefix below the model's minimum
  // announces itself - there is no error, only this number staying at zero.
  it('reports what the cache actually did', () => {
    expect(
      cacheStats({
        input_tokens: 200,
        output_tokens: 50,
        cache_creation_input_tokens: 1830,
        cache_read_input_tokens: 0,
      } as never),
    ).toEqual({ written: 1830, read: 0, uncached: 200 });
  });

  it('treats absent cache fields as zero rather than undefined', () => {
    expect(cacheStats({ input_tokens: 200, output_tokens: 50 } as never)).toEqual({
      written: 0,
      read: 0,
      uncached: 200,
    });
  });
});
