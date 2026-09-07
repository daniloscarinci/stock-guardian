/**
 * THE ONLY MODULE IN THIS APPLICATION PERMITTED TO REACH THE NETWORK.
 *
 * Everything else - the database, the parser, the reports, the backup - runs
 * with the radio off, and `scripts/audit-offline.mjs` fails the build over any
 * external URL it finds. That audit now carries an allowlist naming this exact
 * path, `src/services/ai/client.ts`, and one host. It is written that way for
 * the same reason `webspeech.ts` is the only module allowed to touch
 * `SpeechRecognition`: a promise that holds in exactly one place can be checked
 * by a script, and a promise that holds "wherever we were careful" cannot.
 *
 * WHAT BREAKS IF A SECOND ONE APPEARS. Nothing, immediately - which is the
 * problem. The build keeps passing if the second module is quiet enough, the
 * `connect-src` in the Content-Security-Policy still allows the host, and the
 * sentence in `docs/OFFLINE.md` that lists what leaves the device becomes
 * false without anybody editing it. The audit's allowlist is the thing that
 * makes a second network module a build failure instead of a discovery. So:
 * import the client from here, hand it the question, and let it come back.
 * Do not construct an `Anthropic` anywhere else, and do not `fetch` at all.
 *
 * With no key set, nothing here runs. `createClient` returns null rather than
 * a client aimed at an empty credential, and `converse` turns that null into a
 * stated failure before a single byte is addressed anywhere.
 */
import Anthropic from '@anthropic-ai/sdk';

/**
 * The one host, named once.
 *
 * Exported so the audit's allowlist and the CSP can be checked against the
 * string the code actually uses, rather than against a copy of it.
 */
export const ANTHROPIC_HOST = 'https://api.anthropic.com';

/**
 * A client, or null when there is no key to build one from.
 *
 * Null rather than a throw, because "no key" is the default state of this
 * application and not an error in it. Someone who has never opened the
 * assistant settings has no key, and asking a question in that state should
 * produce a sentence explaining what to do - which is `converse`'s job - not a
 * stack trace.
 *
 * The two browser flags are both required and both mean the same thing said to
 * different listeners. `dangerouslyAllowBrowser` is the SDK's own refusal to
 * run client-side, waived here because the key belongs to the person holding
 * the phone: it is theirs, it is in their database, and there is no server in
 * this application to keep it on. The header is the API's counterpart, and
 * without it the request is rejected at the other end.
 */
export function createClient(apiKey: string): Anthropic | null {
  const key = apiKey.trim();
  if (key === '') return null;

  return new Anthropic({
    apiKey: key,
    baseURL: ANTHROPIC_HOST,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
  });
}
