module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Стили зависят от темы (светлая/тёмная), поэтому собираются прямо в разметке.
    'react-native/no-inline-styles': 'off',
  },
};
