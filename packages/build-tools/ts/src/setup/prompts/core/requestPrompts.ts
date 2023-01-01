import prompts from 'prompts';

import { orderPrompts } from './orderPrompts';
import type { AnyPromptFactory, ExtractPromptAnswers } from './types';

export async function requestPrompts<F extends Array<AnyPromptFactory>>(
  factories: F
): Promise<
  | { status: 'ok'; answers: ExtractPromptAnswers<F> }
  | { status: 'cancelled'; answers?: undefined }
> {
  const ordered = orderPrompts(factories);
  const answers = {};

  for await (const level of ordered) {
    const promptObjects = await Promise.all(
      level.map((factory) =>
        Promise.resolve(factory(answers)).then((result) =>
          Array.isArray(result) ? result : [result]
        )
      )
    );
    let cancelled = false;
    const results = await prompts(promptObjects.flat(), {
      onCancel() {
        cancelled = true;
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (cancelled) {
      return {
        status: 'cancelled',
      };
    }
    Object.assign(answers, results);
  }

  return {
    status: 'ok',
    answers: answers as ExtractPromptAnswers<F>,
  };
}
