import React, { useEffect } from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import MusicPlayerScreen from './screens/MusicPlayerScreen';
import PlaylistScreen from './screens/PlaylistScreen';
import { useColorScheme } from 'react-native';
import * as Font from 'expo-font';

const Stack = createStackNavigator();

export default function App() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    const loadFonts = async () => {
      await Font.loadAsync({
        'Poppins-Black': require('./assets/fonts/Poppins-Black.ttf'),
        'Poppins-Bold': require('./assets/fonts/Poppins-Bold.ttf'),
        'Poppins-SemiBold': require('./assets/fonts/Poppins-SemiBold.ttf'),
        'Poppins-Medium': require('./assets/fonts/Poppins-Medium.ttf'),
        'Poppins-Regular': require('./assets/fonts/Poppins-Regular.ttf'),
        'Poppins-Light': require('./assets/fonts/Poppins-Light.ttf'),
      });
    };
    loadFonts();
  }, []);

  return (
    <NavigationContainer theme={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack.Navigator 
        initialRouteName="MusicPlayerScreen"
        screenOptions={{ 
          headerShown: false,
          gestureEnabled: true,
        }}
      >
        <Stack.Screen name="MusicPlayerScreen" component={MusicPlayerScreen} />
        <Stack.Screen name="PlaylistScreen" component={PlaylistScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}