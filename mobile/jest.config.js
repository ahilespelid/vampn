module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // первый тест файла App импортирует весь React Native и на холодном кэше идёт 10–20 секунд: с 5 секундами он падал,
  // а остальные тесты файла сыпались следом («Can't access .root on unmounted test renderer»)
  testTimeout: 60000,
};
