import {ActivityIndicator, StatusBar, View, useColorScheme} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AuthProvider, useAuth} from './src/auth';
import {LoginScreen} from './src/screens/LoginScreen';
import {Shell} from './src/Shell';
import {resolveTheme, ThemeContext} from './src/theme';

function Root() {
  const auth = useAuth();
  const system = useColorScheme();
  const theme = resolveTheme(auth.themeMode, system === 'dark');

  return (
    <ThemeContext.Provider value={theme}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <View style={{flex: 1, backgroundColor: theme.bg}}>
        {!auth.ready ? (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
            <ActivityIndicator color={theme.muted} />
          </View>
        ) : auth.user ? (
          <Shell />
        ) : (
          <LoginScreen />
        )}
      </View>
    </ThemeContext.Provider>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;
