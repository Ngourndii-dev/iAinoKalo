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

export default function MusicPlayerScreen() {
  const colorScheme = useColorScheme();
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicFiles, setMusicFiles] = useState<Track[]>([]);
  const [filteredMusicFiles, setFilteredMusicFiles] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [shouldPlayNext, setShouldPlayNext] = useState(true); // Nouveau state pour contrôler la lecture automatique
  const fadeAnim = useState(new Animated.Value(0))[0];
  const navigation = useNavigation();
  const animatedValues = musicFiles.map(() => new Animated.Value(1));
  const [searchText, setSearchText] = useState('');
  const notificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    (async () => {
      await Notifications.setNotificationCategoryAsync('musicControls', [
        { identifier: 'play-pause', buttonTitle: 'Play/Pause', options: { isDestructive: false } },
        { identifier: 'next', buttonTitle: 'Next', options: { isDestructive: false } },
        { identifier: 'previous', buttonTitle: 'Previous', options: { isDestructive: false } },
      ]);
    })();

    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    (async () => {
      const allAudio = await fetchAllAudioFiles();
      setMusicFiles(allAudio);
      setFilteredMusicFiles(allAudio);
    })();

    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
      if (notificationIdRef.current) {
        Notifications.dismissNotificationAsync(notificationIdRef.current);
      }
    };
  }, []);

  const fetchAllAudioFiles = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return [];

    let allAudioFiles: MediaLibrary.Asset[] = [];
    let nextPage = true;
    let media = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 100 });

    while (nextPage) {
      allAudioFiles = [...allAudioFiles, ...media.assets];
      if (media.hasNextPage) {
        media = await MediaLibrary.getAssetsAsync({ 
          mediaType: 'audio', 
          first: 100, 
          after: media.endCursor 
        });
      } else {
        nextPage = false;
      }
    }

    return allAudioFiles.map((item) => ({
      id: item.id,
      uri: item.uri,
      filename: item.filename,
      duration: item.duration || 0,
    }));
  };

  const playSound = async (index: number, fromNext = false) => {
    try {
      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: musicFiles[index].uri },
        { shouldPlay: true }
      );

      setCurrentSound(sound);
      setIsPlaying(true);
      setCurrentTrackIndex(index);
      // Désactiver la lecture automatique lors d'un clic manuel
      if (!fromNext) {
        setShouldPlayNext(false);
      }

      sound.setOnPlaybackStatusUpdate(async (status) => {
        if (status.isLoaded && status.didJustFinish && shouldPlayNext) {
          await sound.unloadAsync();
          const nextIndex = (index + 1) % musicFiles.length;
          playSound(nextIndex, true);
        } else if (status.isLoaded && status.didJustFinish) {
          await sound.unloadAsync();
          setCurrentSound(null);
          setIsPlaying(false);
          setShouldPlayNext(true); // Réactiver pour le prochain clic
        }
      });

      await updateNotification(musicFiles[index]);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      animateEqualizer(index);
    } catch (error) {
      console.error('Failed to play sound', error);
    }
  };

  const togglePlayPause = async () => {
    if (!currentSound) return;

    if (isPlaying) {
      await currentSound.pauseAsync();
      setIsPlaying(false);
    } else {
      await currentSound.playAsync();
      setIsPlaying(true);
      animateEqualizer(currentTrackIndex);
    }
    
    if (currentTrackIndex !== -1) {
      await updateNotification(musicFiles[currentTrackIndex]);
    }
  };

  const playNext = async () => {
    if (musicFiles.length === 0) return;
    setShouldPlayNext(true); // Activer la lecture automatique pour le bouton suivant
    const nextIndex = (currentTrackIndex + 1) % musicFiles.length;
    await playSound(nextIndex, true);
  };

  const playPrevious = async () => {
    if (musicFiles.length === 0) return;
    setShouldPlayNext(true); // Activer la lecture automatique pour le bouton précédent
    const prevIndex = (currentTrackIndex - 1 + musicFiles.length) % musicFiles.length;
    await playSound(prevIndex, true);
  };

  const stopSound = async () => {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      setCurrentSound(null);
      setIsPlaying(false);
      setCurrentTrackIndex(-1);
      setShouldPlayNext(true);
      await dismissAllNotifications();
    }
  };

  const dismissAllNotifications = async () => {
    if (notificationIdRef.current) {
      await Notifications.dismissNotificationAsync(notificationIdRef.current);
      notificationIdRef.current = null;
    }
    await Notifications.dismissAllNotificationsAsync();
  };

  const updateNotification = async (track: Track) => {
    await dismissAllNotifications();

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: track.filename,
        body: isPlaying ? 'Playing' : 'Paused',
        sound: false,
        sticky: true,
        data: { trackId: track.id },
        categoryIdentifier: 'musicControls',
      },
      trigger: null,
    });
    notificationIdRef.current = notificationId;
  };

  const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
    const actionIdentifier = response.actionIdentifier;
    switch (actionIdentifier) {
      case 'play-pause':
        await togglePlayPause();
        break;
      case 'next':
        await playNext();
        break;
      case 'previous':
        await playPrevious();
        break;
      case Notifications.DEFAULT:
        break;
    }
  };

  const animateEqualizer = (index: number) => {
    if (index < 0 || index >= animatedValues.length) return;
    const animation = Animated.sequence([
      Animated.timing(animatedValues[index], { toValue: 1.5, duration: 300, useNativeDriver: true }),
      Animated.timing(animatedValues[index], { toValue: 1, duration: 300, useNativeDriver: true }),
    ]);
    Animated.loop(animation).start();
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
    <View style={styles(colorScheme).container}>
      <Text style={styles(colorScheme).title}>🎵 Music Player 🎵</Text>
      <TextInput
        style={styles(colorScheme).searchInput}
        placeholder="Search Songs..."
        placeholderTextColor="#888"
        value={searchText}
        onChangeText={handleSearch}
      />
      <FlatList
        data={filteredMusicFiles}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          const isCurrent = currentTrackIndex === index;
          return (
            <TouchableOpacity
              onPress={() => playSound(index)}
              style={[styles(colorScheme).songItem, isCurrent && styles(colorScheme).currentSong]}
            >
              <Text style={styles(colorScheme).songTitle}>{item.filename}</Text>
              {isCurrent && (
                <View style={styles(colorScheme).equalizer}>
                  {[...Array(3)].map((_, i) => (
                    <Animated.View
                      key={i}
                      style={[styles(colorScheme).bar, { transform: [{ scaleY: animatedValues[index] }] }]}
                    />
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
      {currentTrackIndex !== -1 && (
        <Animated.View style={[styles(colorScheme).controls, { opacity: fadeAnim }]}>
          <TouchableOpacity onPress={playPrevious} style={styles(colorScheme).controlButton}>
            <Text style={styles(colorScheme).icon}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={togglePlayPause} style={styles(colorScheme).controlButton}>
            <Text style={styles(colorScheme).icon}>{isPlaying ? '❚❚' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={playNext} style={styles(colorScheme).controlButton}>
            <Text style={styles(colorScheme).icon}>⏭</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
      <TouchableOpacity
        onPress={() => navigation.navigate('Playlist')}
        style={styles(colorScheme).playlistButton}
      >
        <Text style={styles(colorScheme).playlistButtonText}>Go to Playlist</Text>
      </TouchableOpacity>
    </View>
  );
}

// Les styles restent inchangés
const styles = (scheme: 'light' | 'dark' | null) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: scheme === 'dark' ? '#0a0f1c' : '#f5f5f5',
      padding: 16,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      textAlign: 'center',
      marginVertical: 20,
    },
    searchInput: {
      height: 45,
      backgroundColor: scheme === 'dark' ? '#1f2a40' : '#e0e0e0',
      borderRadius: 10,
      paddingHorizontal: 15,
      marginBottom: 20,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      fontSize: 16,
    },
    songItem: {
      backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
      padding: 12,
      borderRadius: 10,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? '#1f2a40' : '#d0d0d0',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    currentSong: {
      backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#e0e0e0',
      borderColor: scheme === 'dark' ? '#3b4d7d' : '#c0c0c0',
    },
    songTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      fontWeight: '600',
    },
    equalizer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    bar: {
      width: 4,
      height: 20,
      marginHorizontal: 2,
      backgroundColor: scheme === 'dark' ? '#1e90ff' : '#007bff',
      borderRadius: 2,
    },
    controls: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginTop: 30,
      backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
      padding: 15,
      borderRadius: 15,
      elevation: 6,
    },
    controlButton: {
      padding: 12,
      borderRadius: 50,
      backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#e0e0e0',
    },
    icon: {
      fontSize: 30,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
    },
    playlistButton: {
      backgroundColor: '#1a2b4d',
      padding: 12,
      borderRadius: 10,
      marginTop: 20,
      alignItems: 'center',
    },
    playlistButtonText: {
      fontSize: 18,
      color: '#ffffff',
      fontWeight: '600',
    },
  });