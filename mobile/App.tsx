import {useState} from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {HomeScreen} from './src/screens/HomeScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {themeFor} from './src/theme';

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inverted, setInverted] = useState(false);
  const theme = themeFor(inverted);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={inverted ? 'light-content' : 'dark-content'} />
      <View style={[styles.root, {backgroundColor: theme.background}]}>
        {settingsOpen ? (
          <SettingsScreen theme={theme} onClose={() => setSettingsOpen(false)} />
        ) : (
          <HomeScreen
            theme={theme}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleTheme={() => setInverted(value => !value)}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export default App;
