import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, FlatList, Animated, TextInput, useColorScheme } from 'react-native';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import { useNavigation } from '@react-navigation/native';

export default function MusicPlayerScreen() {
  const colorScheme = useColorScheme(); 
  const [sounds, setSounds] = useState<Audio.Sound[]>([]);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicFiles, setMusicFiles] = useState<MediaLibrary.Asset[]>([]);
  const [filteredMusicFiles, setFilteredMusicFiles] = useState<MediaLibrary.Asset[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number | null>(null);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const navigation = useNavigation();
  const animatedValues = musicFiles.map(() => new Animated.Value(1));
  const [searchText, setSearchText] = useState('');
  
  const fetchAllAudioFiles = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('Permission refusée pour accéder à la bibliothèque multimédia.');
      return [];
    }
  
    let allAudioFiles = [];
    let nextPage = true;
    let media = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 100 });
  
    while (nextPage) {
      allAudioFiles = [...allAudioFiles, ...media.assets];
  
      if (media.hasNextPage) {
        media = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 100, after: media.endCursor });
      } else {
        nextPage = false;
      }
    }
  
    return allAudioFiles;
  };
  
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
      };
    }, []);
  

  const handleSearch = (text: string) => {
    setSearchText(text);
    if (text) {
      const filtered = musicFiles.filter((file) => file.filename.toLowerCase().includes(text.toLowerCase()));
      setFilteredMusicFiles(filtered);
    } else {
      setFilteredMusicFiles(musicFiles);
    }
  };

  const playSound = async (index: number) => {
    try {
      if (currentSound) {
        await currentSound.unloadAsync();
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri: musicFiles[index].uri },
        { shouldPlay: true }
      );
      setCurrentSound(sound);
      setIsPlaying(true);
      setCurrentTrackIndex(index);
      await sound.playAsync();
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
      animateEqualizer(index);
    } catch (error) {
      console.error('Failed to play sound', error);
    }
  };

  const togglePlayPause = async () => {
    try {
      if (currentSound) {
        if (isPlaying) {
          await currentSound.pauseAsync();
        } else {
          await currentSound.playAsync();
          if (currentTrackIndex !== null) animateEqualizer(currentTrackIndex);
        }
        setIsPlaying(!isPlaying);
      }
    } catch (error) {
      console.error('Failed to toggle play/pause', error);
    }
  };

  const playNext = () => {
    const nextIndex = currentTrackIndex !== null ? (currentTrackIndex + 1) % musicFiles.length : 0;
    playSound(nextIndex);
  };

  const playPrevious = () => {
    const prevIndex = currentTrackIndex !== null ? (currentTrackIndex - 1 + musicFiles.length) % musicFiles.length : 0;
    playSound(prevIndex);
  };

  const animateEqualizer = (index: number) => {
    const animation = Animated.sequence([
      Animated.timing(animatedValues[index], {
        toValue: 1.5,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(animatedValues[index], {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]);
    Animated.loop(animation).start();
  };

  return (
    <View style={styles(colorScheme).container}>
      <Text style={styles(colorScheme).title}>🎵 My Music Player 🎵</Text>
      <TextInput
        style={styles(colorScheme).searchInput}
        placeholder="Search Songs..."
        value={searchText}
        onChangeText={handleSearch}
      />
      <FlatList
        data={filteredMusicFiles}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          const isCurrent = currentTrackIndex === index;
          return (
            <TouchableOpacity onPress={() => playSound(index)} style={[styles(colorScheme).songItem, isCurrent && styles(colorScheme).currentSong]}>
              <Text style={styles(colorScheme).songTitle}>{item.filename}</Text>
              {isCurrent && (
                <View style={styles(colorScheme).equalizer}>
                  {[...Array(3)].map((_, i) => (
                    <Animated.View key={i} style={[styles(colorScheme).bar, { transform: [{ scaleY: animatedValues[index] }] }]} />
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
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
      <TouchableOpacity onPress={() => navigation.navigate('Playlist')} style={styles(colorScheme).playlistButton}>
        <Text style={styles(colorScheme).playlistButtonText}>Go to Playlist</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (scheme: 'light' | 'dark' | null) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: scheme === 'dark' ? '#0a0f1c' : '#f5f5f5',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: scheme === 'dark' ? '#ffffff' : '#000000',
    textAlign: 'center',
    marginBottom: 20,
  },
  searchInput: {
    height: 40,
    backgroundColor: scheme === 'dark' ? '#1f2a40' : '#e0e0e0',
    borderRadius: 8,
    paddingLeft: 10,
    marginBottom: 20,
    color: scheme === 'dark' ? '#ffffff' : '#000000',
  },
  songItem: {
    backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
    padding: 12,
    borderRadius: 10,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: scheme === 'dark' ? '#1f2a40' : '#d0d0d0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: scheme === 'dark' ? '#000' : '#ccc',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
  currentSong: {
    backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#e0e0e0',
    borderColor: scheme === 'dark' ? '#3b4d7d' : '#c0c0c0',
  },
  songTitle: {
    fontSize: 18,
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
    backgroundColor: scheme === 'dark' ? '#ffffff' : '#000000',
    borderRadius: 2,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 30,
    alignItems: 'center',
    backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
    padding: 20,
    borderRadius: 20,
    shadowColor: scheme === 'dark' ? '#000' : '#ccc',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
  controlButton: {
    padding: 10,
  },
  icon: {
    fontSize: 40,
    color: scheme === 'dark' ? '#ffffff' : '#000000',
  },
  playlistButton: {
    backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#e0e0e0',
    padding: 10,
    borderRadius: 10,
    marginTop: 20,
    alignItems: 'center',
  },
  playlistButtonText: {
    fontSize: 18,
    color: scheme === 'dark' ? '#ffffff' : '#000000',
  },
});