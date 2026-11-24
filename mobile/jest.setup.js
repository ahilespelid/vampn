/* eslint-env jest */
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({children}) => children,
  useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    setItem: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    getItem: jest.fn(async key => (store.has(key) ? store.get(key) : null)),
    removeItem: jest.fn(async key => {
      store.delete(key);
    }),
    clear: jest.fn(async () => {
      store.clear();
    }),
  };
});

// Keychain в тестах — одна запись в памяти. `__reset` очищает её между тестами.
jest.mock('react-native-keychain', () => {
  let item = null;
  return {
    ACCESSIBLE: {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly'},
    setGenericPassword: jest.fn(async (username, password) => {
      item = {username, password};
      return {service: 'test', storage: 'keychain'};
    }),
    getGenericPassword: jest.fn(async () => (item ? {...item, service: 'test', storage: 'keychain'} : false)),
    resetGenericPassword: jest.fn(async () => {
      item = null;
      return true;
    }),
    __reset: () => {
      item = null;
    },
  };
});
