export default () => {
  return {
    autoDetect: true,
    env: {
      params: {
        runner:
          '--experimental-vm-modules --experimental-specifier-resolution=node',
      },
    },
    testFramework: {
      path: './node_modules/@repka-kit/ts/node_modules/jest',
    },
  };
};
