import { promptFactory } from './core';

export const repositoryTypePrompt = promptFactory(() => {
  return [
    {
      message: 'Please select the type of repository you wish to initialize',
      name: 'repositoryType' as const,
      type: 'select',
      choices: [
        {
          title: 'monorepo',
          description: 'Setup for multiple packages',
          value: 'mono' as const,
        },
        {
          title: 'solo',
          description:
            'You only ever going to have a single package in your repository',
          value: 'solo' as const,
        },
      ],
    },
  ];
}, []);
