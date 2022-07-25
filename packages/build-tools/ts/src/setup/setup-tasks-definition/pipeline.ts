import prompts from 'prompts';

import { filterTruthy } from '../../utils/isTruthy';
import type { TaskDefinition } from './definition';
import { createTasksApi } from './tasksApi';

export async function taskPipeline(definitions: TaskDefinition[]) {
  const api = createTasksApi();

  const tasksToExecute = filterTruthy(
    await Promise.all(
      definitions.map((entry) =>
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
    instructions:
      'You can disable modifications that you want to skip for now by unselecting them (press space)',
    choices: tasksToExecute.map((entry) => ({
      title: entry.name,
      description: entry.description,
      selected: true,
    })),
  });
  if (!result.selected) {
    process.exitCode = 1;
    return;
  }

  const selected = result.selected as Array<number>;

  for (const definition of filterTruthy(
    selected.map((index) => definitions[index])
  )) {
    await definition.execute(api);
  }

  await api.commit();
}
