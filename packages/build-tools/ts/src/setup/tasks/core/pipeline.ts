import { filterTruthy } from '@utils/ts';
import prompts from 'prompts';

import type {
  AnyPromptFactory,
  ExtractPromptAnswers,
} from '../../prompts/core';
import { requestPrompts } from '../../prompts/core';
import type { TaskDefinition, TasksApi } from './definition';
import { createTasksApi } from './tasksApi';

export async function taskPipeline<Prompts extends AnyPromptFactory[]>(
  factories: Prompts,
  definitions: Prompts extends never[]
    ? (
        tasks: TasksApi
      ) => Array<TaskDefinition> | Promise<Array<TaskDefinition>>
    : (
        tasks: TasksApi,
        answers: ExtractPromptAnswers<Prompts>
      ) => Array<TaskDefinition> | Promise<Array<TaskDefinition>>
) {
  const api = createTasksApi();

  const promptResult = await requestPrompts(factories);
  if (promptResult.status === 'cancelled') {
    console.log('...cancelling');
    process.exitCode = 1;
    return;
  }

  const defs = await Promise.resolve(definitions(api, promptResult.answers));

  const tasksToExecute = filterTruthy(
    await Promise.all(
      defs.map((entry) =>
        Promise.resolve(
          entry.shouldExecute
            ? entry
                .shouldExecute(api)
                .then((should) => (should ? entry : undefined))
            : Promise.resolve(entry)
        )
      )
    )
  );

  const result = await prompts({
    message: 'Following modifications are going to be made',
    name: 'selected',
    type: 'multiselect',
    // instructions:
    //   'You can disable modifications that you want to skip for now by unselecting them (press space)',
    choices: tasksToExecute.map((entry) => ({
      title: entry.name,
      description: entry.description,
      selected: true,
    })),
  });

  if (!result.selected) {
    console.log('...cancelling');
    process.exitCode = 1;
    return;
  }

  const selected = result.selected as Array<number>;

  const selectedDefs = filterTruthy(
    selected.map((index) => tasksToExecute[index])
  );

  for (const definition of selectedDefs) {
    await definition.execute(api);
  }

  await api.commit();
}
