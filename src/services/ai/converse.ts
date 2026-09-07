/**
 * One question, answered.
 *
 * A hand-written tool-use loop rather than the SDK's runner, and that is not
 * taste. The runner executes the tools it is given, which is exactly right for
 * tools that may run - and exactly wrong for four of these, which must be
 * intercepted, turned into proposals, and answered with "the user has not
 * agreed to this yet". Owning the loop is what keeps `tools.ts` free to lie to
 * Claude about having done something, honestly.
 *
 * The shape of a turn:
 *
 *   send the question, the tools and the system prompt
 *   while the model asks for tools:
 *     run them all, return EVERY result in ONE user message
 *   stop on any other reason, or on the turn cap
 *
 * All results in one message matters: splitting them across several teaches
 * the model to stop asking for tools in parallel, and a question about expiry
 * and shopping wants both lists at once.
 *
 * What leaves the device is the question, the tool results Claude asked for,
 * and the answer. Never the inventory. `docs/OFFLINE.md` says the same thing
 * in prose, and `tools.ts` is what makes it true.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from './client';
import { TOOLS, runTool, type AiDeps } from './tools';
import type { PendingWrite } from '../voice/execute';
import type { Language } from '../../domain/settings';

/**
 * Why a turn produced no answer. Translation-key suffixes, and nothing more.
 *
 * Each names something the user can act on: set a key, wait, reconnect, or
 * accept that this question is not one Claude will take. The interface reads
 * `ai.failed{Reason}` and says so; nothing here composes a sentence.
 */
export type AiFailureReason =
  | 'noKey' // no key is set, so nothing was constructed and nothing was sent
  | 'auth' // the key was refused
  | 'rateLimit' // too many questions, too fast
  | 'offline' // the request never reached anyone
  | 'api'; // anything else the API or the loop threw

export type AiOutcome =
  | {
      readonly kind: 'answer';
      readonly text: string;
      /**
       * Writes Claude asked for and did not get. Each becomes a confirmation
       * card; until one is confirmed, none of them has touched the database.
       */
      readonly proposals: readonly PendingWrite[];
      /** Requests made. Roughly what the question cost. */
      readonly requests: number;
    }
  | {
      readonly kind: 'refused';
      readonly category: string | null;
      readonly explanation: string | null;
    }
  | {
      /**
       * The loop hit its cap with the model still asking for tools.
       *
       * Reported rather than pushed one turn further, because a loop that
       * quietly extends itself is a loop with no cap. The proposals gathered
       * so far are kept: they were built, they cost nothing to show, and
       * discarding them would lose work the user can still say yes to.
       */
      readonly kind: 'exhausted';
      readonly proposals: readonly PendingWrite[];
      readonly requests: number;
    }
  | {
      readonly kind: 'failed';
      readonly reason: AiFailureReason;
      /** The API's own words, for the log. Not for the interface. */
      readonly detail: string | null;
    };

export interface AiOptions {
  readonly apiKey: string;
  readonly model: string;
}

/**
 * How many requests one question may make.
 *
 * Eight is four or five tools' worth of thinking plus room to recover from a
 * tie or a misspelled place - past which a loop is not working towards an
 * answer, it is circling, and every lap is billed to the user.
 */
export const MAX_REQUESTS = 8;

/** Non-streaming, so this stays under the SDK's HTTP timeout. */
const MAX_TOKENS = 16000;

const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: 'English',
  'pt-BR': 'Brazilian Portuguese',
  es: 'Spanish',
};

/**
 * What Claude is told about this application, and nothing else.
 *
 * Short on purpose. This model degrades under over-prescription - a page of
 * rules produces a worse answer than four lines - so it says the four things
 * that are load-bearing and stops: where the facts come from, that the writing
 * tools do not write, that a number nobody gave must not be invented, and
 * which language to answer in. Everything else Claude works out from the tool
 * descriptions, which is where per-tool guidance belongs.
 */
export function systemPrompt(language: Language, today: string): string {
  return [
    "You are the assistant inside Stock Guardian, a household inventory and preparedness app that runs entirely on the user's own device.",
    `Today is ${today}. Read the stock with the tools rather than recalling it: every quantity, date, place and score you state must have come back from a tool.`,
    'The writing tools do not write. Each one proposes a change and the user confirms it afterwards, so report what you proposed, never that you changed anything. Do not invent a quantity or a date the user did not give - ask for it.',
    `Answer in ${LANGUAGE_NAMES[language]}, briefly.`,
  ].join('\n\n');
}

/** The text blocks of a reply, joined. Thinking blocks are not the answer. */
function answerText(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * An error, classified.
 *
 * Most specific first, because the distinctions are what the interface needs:
 * a refused key is the user's to fix, a rate limit is worth retrying, and a
 * connection error means the phone is doing exactly what this application was
 * built to keep doing - working without a network - which is worth saying
 * rather than reporting as a fault.
 */
function classify(error: unknown): AiOutcome {
  const detail = error instanceof Error ? error.message : null;

  if (error instanceof Anthropic.AuthenticationError) {
    return { kind: 'failed', reason: 'auth', detail };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { kind: 'failed', reason: 'rateLimit', detail };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: 'failed', reason: 'offline', detail };
  }
  if (error instanceof Anthropic.APIError) {
    return { kind: 'failed', reason: 'api', detail };
  }
  return { kind: 'failed', reason: 'api', detail };
}

export async function converse(
  deps: AiDeps,
  options: AiOptions,
  question: string,
): Promise<AiOutcome> {
  // With no key nothing is constructed and nothing is addressed anywhere. This
  // is the default state of the application, so it is an outcome and not an
  // error.
  const client = createClient(options.apiKey);
  if (client === null) return { kind: 'failed', reason: 'noKey', detail: null };

  const proposals: PendingWrite[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  const system = systemPrompt(deps.language, deps.context.today);

  try {
    for (let requests = 1; requests <= MAX_REQUESTS; requests += 1) {
      const message = await client.messages.create({
        model: options.model,
        max_tokens: MAX_TOKENS,
        system,
        tools: [...TOOLS],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        messages,
      });

      // Checked before the content is read: a refusal carries its reason in
      // `stop_details` and its content is not an answer to the question.
      if (message.stop_reason === 'refusal') {
        return {
          kind: 'refused',
          category: message.stop_details?.category ?? null,
          explanation: message.stop_details?.explanation ?? null,
        };
      }

      // Pushed whole rather than as text. Thinking blocks travel with the turn
      // they belong to, and stripping them would break the next request.
      messages.push({ role: 'assistant', content: message.content });

      if (message.stop_reason !== 'tool_use') {
        return { kind: 'answer', text: answerText(message.content), proposals, requests };
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== 'tool_use') continue;
        const run = await runTool(deps, block.name, block.input);
        if (run.proposal !== null) proposals.push(run.proposal);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: run.result,
          ...(run.isError ? { is_error: true } : {}),
        });
      }

      // Every result, in one message. See the note at the top of the file.
      messages.push({ role: 'user', content: results });
    }

    return { kind: 'exhausted', proposals, requests: MAX_REQUESTS };
  } catch (error) {
    return classify(error);
  }
}
