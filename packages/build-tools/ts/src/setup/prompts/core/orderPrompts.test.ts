import { expect, it } from '@jest/globals';

import { orderPrompts } from './orderPrompts';
import type { AnyPromptFactory } from './types';
import { promptFactory } from './types';

it('should order single prompt', () => {
  const promptA = promptFactory(() => ({
    name: 'promptA',
    type: 'text',
    initial: 'A',
  }));

  const ordered = orderPrompts([promptA]);
  expect(ordered).toEqual([[promptA]]);
});

it('should order two independent prompts', () => {
  const promptA = promptFactory(() => ({
    name: 'promptA',
    type: 'text',
    initial: 'A',
  }));

  const promptB = promptFactory(() => ({
    name: 'promptB',
    type: 'text',
    initial: 'B',
  }));

  const ordered = orderPrompts([promptA, promptB]);
  expect(ordered).toEqual([[promptA, promptB]]);
});

it('should order two dependent prompts', () => {
  const promptA = promptFactory(() => ({
    name: 'promptA',
    type: 'text',
    initial: 'A',
  }));

  const promptB = promptFactory(
    () => ({
      name: 'promptB',
      type: 'text',
      initial: 'B',
    }),
    [promptA]
  );

  const ordered = orderPrompts([promptA, promptB]);
  expect(ordered).toEqual([[promptA], [promptB]]);
});

it('should order multiple dependent prompts', () => {
  const promptA = promptFactory(() => ({
    name: 'promptA',
    type: 'text',
    initial: 'A',
  }));

  const promptB = promptFactory(
    () => ({
      name: 'promptB',
      type: 'text',
      initial: 'B',
    }),
    [promptA]
  );

  const promptC = promptFactory(
    () => ({
      name: 'promptC',
      type: 'text',
      initial: 'C',
    }),
    [promptA, promptB]
  );

  const ordered = orderPrompts([promptC]);
  expect(ordered).toEqual([[promptA], [promptB], [promptC]]);
});

it('should throw when ordering is not possible', () => {
  const promptA = promptFactory(
    () => ({
      name: 'promptA',
      type: 'text',
      initial: 'A',
    }),
    []
  );

  const promptB = promptFactory(
    () => ({
      name: 'promptB',
      type: 'text',
      initial: 'B',
    }),
    [promptA]
  );

  (promptA.dependsOn as AnyPromptFactory[]).push(promptB);

  expect(() =>
    orderPrompts([promptA, promptB])
  ).toThrowErrorMatchingInlineSnapshot(
    `"Cannot determine the order of execution of prompts, dependencies form a cycle?"`
  );
});
