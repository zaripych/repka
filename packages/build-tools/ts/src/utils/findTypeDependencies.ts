import { filterTruthy } from '@utils/ts';

import { findDevDependency } from './findDevDependency';

export async function findTypeDependencies(typeDependencies: string[]) {
  const locations = await Promise.all(
    typeDependencies.map((typeDep) =>
      findDevDependency({
        lookupPackageName: typeDep,
      })
    )
  );
  return filterTruthy(locations);
}
