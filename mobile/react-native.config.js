const fs = require('fs');
const path = require('path');

// Expo packages are for the Expo Go dev server. Leave them out of the bare
// Android and iOS autolinking so those builds stay unchanged.
function nativeExpoPackages() {
  const modulesDir = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  const names = [];
  for (const entry of fs.readdirSync(modulesDir)) {
    if (entry.startsWith('@')) {
      const scopeDir = path.join(modulesDir, entry);
      for (const scoped of fs.readdirSync(scopeDir)) {
        if (entry === '@expo' || scoped.startsWith('expo')) {
          names.push(`${entry}/${scoped}`);
        }
      }
      continue;
    }
    if (entry === 'expo' || entry.startsWith('expo-')) {
      names.push(entry);
    }
  }

  return names.filter(name => {
    const root = path.join(modulesDir, name);
    return (
      fs.existsSync(path.join(root, 'android')) ||
      fs.existsSync(path.join(root, 'ios')) ||
      fs.existsSync(path.join(root, 'expo-module.config.json'))
    );
  });
}

const dependencies = {};
for (const name of nativeExpoPackages()) {
  dependencies[name] = {
    platforms: {
      android: null,
      ios: null,
    },
  };
}

module.exports = {dependencies};
