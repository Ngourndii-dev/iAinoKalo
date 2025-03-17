import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Animated,
  TextInput,
  useColorScheme,
  Dimensions,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import { useNavigation } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';

interface Track {
  id: string;
  uri: string;
  filename: string;
  duration?: number;
}

const getOrientation = () => {
  const { width, height } = Dimensions.get('window');
  return width > height ? 'landscape' : 'portrait';
};

export default function MusicPlayerScreen() {
  const colorScheme = useColorScheme();
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicFiles, setMusicFiles] = useState<Track[]>([]);
  const [filteredMusicFiles, setFilteredMusicFiles] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [shouldPlayNext, setShouldPlayNext] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [orientation, setOrientation] = useState(getOrientation());
  const fadeAnim = useState(new Animated.Value(0))[0];
  const scaleAnim = useState(new Animated.Value(1))[0];
  const navigation = useNavigation();
  const animatedValues = musicFiles.map(() => new Animated.Value(1));
  const notificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', () => {
      setOrientation(getOrientation());
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    const setupNotifications = async () => {
      await Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });

      await Notifications.setNotificationCategoryAsync('musicControls', [
        { identifier: 'play', buttonTitle: 'Play' },
        { identifier: 'pause', buttonTitle: 'Pause' },
        { identifier: 'next', buttonTitle: 'Next' },
        { identifier: 'previous', buttonTitle: 'Previous' },
      ]);
    };

    setupNotifications();
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const loadAudioFiles = async () => {
      const allAudio = await fetchAllAudioFiles();
      setMusicFiles(allAudio);
      setFilteredMusicFiles(allAudio);
    };
    loadAudioFiles();

    return () => {
      const cleanup = async () => {
        if (currentSound) await currentSound.unloadAsync();
        await dismissNotification();
      };
      cleanup();
    };
  }, []);

  const fetchAllAudioFiles = async (): Promise<Track[]> => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return [];

    let allAudioFiles: MediaLibrary.Asset[] = [];
    let hasNextPage = true;
    let after: string | undefined;

    while (hasNextPage) {
      const media = await MediaLibrary.getAssetsAsync({
        mediaType: 'audio',
        first: 100,
        after,
      });
      allAudioFiles = [...allAudioFiles, ...media.assets];
      hasNextPage = media.hasNextPage;
      after = media.endCursor;
    }

    return allAudioFiles.map((item) => ({
      id: item.id,
      uri: item.uri,
      filename: item.filename,
      duration: item.duration || 0,
    }));
  };

  const stopCurrentSound = async () => {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      setCurrentSound(null);
    }
  };

  const playSound = async (index: number, fromNext = false) => {
    await stopCurrentSound();
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: musicFiles[index].uri },
      { shouldPlay: true }
    );

    setCurrentSound(sound);
    setIsPlaying(true);
    setCurrentTrackIndex(index);
    setShouldPlayNext(fromNext);

    sound.setOnPlaybackStatusUpdate(async (status) => {
      if (!status.isLoaded) return;
      if (status.didJustFinish && shouldPlayNext) {
        const nextIndex = (index + 1) % musicFiles.length;
        await playSound(nextIndex, true);
      } else if (status.didJustFinish) {
        await stopCurrentSound();
        setIsPlaying(false);
        setCurrentTrackIndex(-1);
        await dismissNotification();
      }
    });

    await updateNotification(musicFiles[index]);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, useNativeDriver: true }),
    ]).start();
    animateEqualizer(index);
  };

  const togglePlayPause = async () => {
    if (!currentSound || currentTrackIndex === -1) return;
    if (isPlaying) {
      await currentSound.pauseAsync();
      setIsPlaying(false);
    } else {
      await currentSound.playAsync();
      setIsPlaying(true);
      animateEqualizer(currentTrackIndex);
    }
    await updateNotification(musicFiles[currentTrackIndex]);
  };

  const playNext = async () => {
    if (musicFiles.length === 0) return;
    const nextIndex = (currentTrackIndex + 1) % musicFiles.length;
    setShouldPlayNext(true);
    await playSound(nextIndex, true);
  };

  const playPrevious = async () => {
    if (musicFiles.length === 0) return;
    const prevIndex = (currentTrackIndex - 1 + musicFiles.length) % musicFiles.length;
    setShouldPlayNext(true);
    await playSound(prevIndex, true);
  };

  const dismissNotification = async () => {
    if (notificationIdRef.current) {
      await Notifications.dismissNotificationAsync(notificationIdRef.current);
      notificationIdRef.current = null;
    }
  };

  const updateNotification = async (track: Track) => {
    await Notifications.dismissAllNotificationsAsync();

    const content = {
      title: 'Now Playing',
      body: `${track.filename} - ${isPlaying ? 'Playing' : 'Paused'}`,
      sticky: true,
      data: { trackId: track.id },
      categoryIdentifier: 'musicControls',
    };

    const notificationId = await Notifications.scheduleNotificationAsync({
      content,
      trigger: null,
    });
    notificationIdRef.current = notificationId;
  };

  const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
    const actionIdentifier = response.actionIdentifier;

    switch (actionIdentifier) {
      case 'play':
        if (!isPlaying && currentTrackIndex !== -1) await togglePlayPause();
        else if (currentTrackIndex === -1 && musicFiles.length > 0) await playSound(0);
        break;
      case 'pause':
        if (isPlaying) await togglePlayPause();
        break;
      case 'next':
        await playNext();
        break;
      case 'previous':
        await playPrevious();
        break;
      case Notifications.DEFAULT:
        if (currentTrackIndex !== -1) await playSound(currentTrackIndex);
        break;
    }
  };

  const animateEqualizer = (index: number) => {
    if (index < 0 || index >= animatedValues.length) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValues[index], { toValue: 1.8, duration: 200, useNativeDriver: true }),
        Animated.timing(animatedValues[index], { toValue: 1, duration: 200, useNativeDriver: true }),
      ])
    );
    animation.start();
  };

  const handleSearch = (text: string) => {
    setSearchText(text);
    setFilteredMusicFiles(
      text
        ? musicFiles.filter((file) => file.filename.toLowerCase().includes(text.toLowerCase()))
        : musicFiles
    );
  };

  return (
    <View style={styles(colorScheme, orientation).container}>
      <Text style={styles(colorScheme, orientation).title}>Music Player</Text>
      <TextInput
        style={styles(colorScheme, orientation).searchInput}
        placeholder="Search Songs..."
        placeholderTextColor={colorScheme === 'dark' ? '#9ca3af' : '#6b7280'}
        value={searchText}
        onChangeText={handleSearch}
      />
      <FlatList
        data={filteredMusicFiles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        renderItem={({ item, index }) => {
          const isCurrent = currentTrackIndex === index;
          return (
            <TouchableOpacity
              onPress={() => playSound(index)}
              style={[styles(colorScheme, orientation).songItem, isCurrent && styles(colorScheme, orientation).currentSong]}
            >
              <Text style={styles(colorScheme, orientation).songTitle}>{item.filename}</Text>
              {isCurrent && (
                <View style={styles(colorScheme, orientation).equalizer}>
                  {[...Array(3)].map((_, i) => (
                    <Animated.View
                      key={i}
                      style={[styles(colorScheme, orientation).bar, { transform: [{ scaleY: animatedValues[index] }] }]}
                    />
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
      {currentTrackIndex !== -1 && (
        <Animated.View
          style={[styles(colorScheme, orientation).controls, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}
        >
          <TouchableOpacity onPress={playPrevious} style={styles(colorScheme, orientation).controlButton}>
            <Text style={styles(colorScheme, orientation).icon}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={togglePlayPause} style={styles(colorScheme, orientation).controlButton}>
            <Text style={styles(colorScheme, orientation).icon}>{isPlaying ? '❚❚' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={playNext} style={styles(colorScheme, orientation).controlButton}>
            <Text style={styles(colorScheme, orientation).icon}>⏭</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
      <TouchableOpacity
        onPress={() => navigation.navigate('Playlist')}
        style={styles(colorScheme, orientation).playlistButton}
      >
        <Text style={styles(colorScheme, orientation).playlistButtonText}>Go to Playlist</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (scheme: 'light' | 'dark' | null, orientation: 'portrait' | 'landscape') =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: scheme === 'dark' ? '#0f172a' : '#f8fafc',
      padding: orientation === 'portrait' ? 16 : 24,
    },
    title: {
      fontSize: orientation === 'portrait' ? 28 : 32,
      fontFamily: 'Poppins-Bold',
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      textAlign: 'center',
      marginVertical: orientation === 'portrait' ? 20 : 30,
    },
    searchInput: {
      height: 48,
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0',
      borderRadius: 12,
      paddingHorizontal: 16,
      marginBottom: 20,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontSize: 16,
      fontFamily: 'Poppins-Medium',
      shadowColor: scheme === 'dark' ? '#000' : '#ccc',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    songItem: {
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#ffffff',
      padding: 14,
      borderRadius: 12,
      marginVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      shadowColor: scheme === 'dark' ? '#000' : '#ccc',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    currentSong: {
      backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#dbeafe',
      borderWidth: 1,
      borderColor: scheme === 'dark' ? '#3b82f6' : '#93c5fd',
    },
    songTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontFamily: 'Poppins-Regular',
      flex: 1,
    },
    equalizer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    bar: {
      width: 4,
      height: 20,
      marginHorizontal: 2,
      backgroundColor: scheme === 'dark' ? '#3b82f6' : '#2563eb',
      borderRadius: 2,
    },
    controls: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginTop: orientation === 'portrait' ? 30 : 40,
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#ffffff',
      padding: 16,
      borderRadius: 16,
      shadowColor: scheme === 'dark' ? '#000' : '#ccc',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 8,
    },
    controlButton: {
      padding: 14,
      borderRadius: 50,
      backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#dbeafe',
      transform: [{ scale: 1 }],
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 4,
        },
        android: {
          elevation: 4,
        },
      }),
    },
    icon: {
      fontSize: 28,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontFamily: 'Poppins-Medium',
    },
    playlistButton: {
      backgroundColor: '#1a2b4d',
      padding: 14,
      borderRadius: 12,
      marginTop: 20,
      alignItems: 'center',
      shadowColor: scheme === 'dark' ? '#000' : '#ccc',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    },
    playlistButtonText: {
      fontSize: 18,
      color: '#ffffff',
      fontFamily: 'Poppins-SemiBold',
    },
  });