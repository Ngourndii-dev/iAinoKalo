import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  TextInput,
  Modal,
  Dimensions,
  useColorScheme,
} from 'react-native';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const { width } = Dimensions.get('window');

interface PlaylistItem {
  id: string;
  uri: string;
  filename: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;
}

export default function PlaylistScreen() {
  const colorScheme = useColorScheme();
  const [musicFiles, setMusicFiles] = useState<PlaylistItem[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [filteredMusicFiles, setFilteredMusicFiles] = useState<PlaylistItem[]>([]);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<PlaylistItem | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const navigation = useNavigation();
  const [searchText, setSearchText] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<PlaylistItem | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const notificationIdRef = useRef<string | null>(null); // Pour gérer une seule notification

  // Configurer les notifications interactives
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
        { identifier: 'play-pause', buttonTitle: isPlaying ? 'Pause' : 'Play' },
        { identifier: 'next', buttonTitle: 'Next' },
        { identifier: 'previous', buttonTitle: 'Previous' },
      ]);
    })();

    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => subscription.remove();
  }, [isPlaying]);

  // Charger les fichiers audio
  const fetchAllAudioFiles = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return [];

    let allAudioFiles: MediaLibrary.Asset[] = [];
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

    return Promise.all(
      allAudioFiles.map(async (item) => {
        const metadata = await MediaLibrary.getAssetInfoAsync(item.id);
        return {
          id: item.id,
          uri: item.uri,
          filename: item.filename,
          title: metadata.title || item.filename,
          artist: metadata.artist || 'Unknown Artist',
          album: metadata.album || 'Unknown Album',
          artwork: metadata.artwork || null,
          duration: item.duration || 0,
        };
      })
    );
  };

  useEffect(() => {
    (async () => {
      const allAudio = await fetchAllAudioFiles();
      setMusicFiles(allAudio);
      setFilteredMusicFiles(allAudio);
      loadPlaylist();
    })();

    return () => {
      if (currentSound) currentSound.unloadAsync();
      if (notificationIdRef.current) Notifications.dismissNotificationAsync(notificationIdRef.current);
    };
  }, []);

  // Charger et sauvegarder la playlist
  const loadPlaylist = async () => {
    try {
      const savedPlaylist = await AsyncStorage.getItem('playlist');
      if (savedPlaylist) setPlaylist(JSON.parse(savedPlaylist));
    } catch (error) {
      console.error('Failed to load playlist', error);
    }
  };

  const savePlaylist = async (newPlaylist: PlaylistItem[]) => {
    try {
      await AsyncStorage.setItem('playlist', JSON.stringify(newPlaylist));
    } catch (error) {
      console.error('Failed to save playlist', error);
    }
  };

  // Gestion de la playlist
  const addToPlaylist = (track: PlaylistItem) => {
    if (!playlist.find((item) => item.id === track.id)) {
      const newPlaylist = [...playlist, track];
      setPlaylist(newPlaylist);
      savePlaylist(newPlaylist);
    }
  };

  const removeFromPlaylist = (trackId: string) => {
    const newPlaylist = playlist.filter((item) => item.id !== trackId);
    setPlaylist(newPlaylist);
    savePlaylist(newPlaylist);
    if (currentTrack?.id === trackId) stopSound();
  };

  // Lecture audio
  const playSound = async (track: PlaylistItem, index: number) => {
    try {
      if (currentSound) await currentSound.unloadAsync();

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync({ uri: track.uri }, { shouldPlay: true });
      setCurrentSound(sound);
      setCurrentTrack(track);
      setCurrentIndex(index);
      setIsPlaying(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish && index < playlist.length - 1) {
          playNext(); // Passe à la suivante uniquement si ce n'est pas la dernière
        } else if (status.didJustFinish) {
          stopSound(); // Arrête tout si c'est la dernière piste
        }
      });

      await updateNotification(track);
      await sound.playAsync();
    } catch (error) {
      console.error('Failed to play sound', error);
    }
  };

  const stopSound = async () => {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      setCurrentSound(null);
      setIsPlaying(false);
      setCurrentTrack(null);
      setCurrentIndex(-1);
      if (notificationIdRef.current) {
        await Notifications.dismissNotificationAsync(notificationIdRef.current);
        notificationIdRef.current = null;
      }
    }
  };

  const playNext = () => {
    if (currentIndex < playlist.length - 1) {
      const nextTrack = playlist[currentIndex + 1];
      playSound(nextTrack, currentIndex + 1);
    }
  };

  const playPrevious = () => {
    if (currentIndex > 0) {
      const prevTrack = playlist[currentIndex - 1];
      playSound(prevTrack, currentIndex - 1);
    }
  };

  const togglePlayPause = async () => {
    if (currentSound) {
      if (isPlaying) {
        await currentSound.pauseAsync();
      } else {
        await currentSound.playAsync();
      }
      setIsPlaying(!isPlaying);
      if (currentTrack) await updateNotification(currentTrack);
    }
  };

  // Gestion d'une seule notification
  const updateNotification = async (track: PlaylistItem) => {
    if (notificationIdRef.current) {
      await Notifications.dismissNotificationAsync(notificationIdRef.current);
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: track.title,
        body: `Artist: ${track.artist} | ${isPlaying ? 'Playing' : 'Paused'}`,
        sound: true,
        data: { trackId: track.id },
        categoryIdentifier: 'musicControls',
      },
      trigger: null,
    });
    notificationIdRef.current = notificationId;
  };

  const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
    const actionIdentifier = response.actionIdentifier;
    switch (actionIdentifier) {
      case 'play-pause':
        togglePlayPause();
        break;
      case 'next':
        playNext();
        break;
      case 'previous':
        playPrevious();
        break;
    }
  };

  // Recherche et affichage
  const handleSearch = (text: string) => {
    setSearchText(text);
    setFilteredMusicFiles(
      text
        ? musicFiles.filter((file) => file.title?.toLowerCase().includes(text.toLowerCase()))
        : musicFiles
    );
  };

  const togglePlaylist = () => setShowPlaylist(!showPlaylist);

  const renderPlaylistItem = ({ item, index }: { item: PlaylistItem; index: number }) => (
    <TouchableOpacity onPress={() => playSound(item, index)} style={styles(colorScheme).playlistItem}>
      <Text style={styles(colorScheme).playlistTitle}>{item.title}</Text>
      <TouchableOpacity onPress={() => removeFromPlaylist(item.id)}>
        <Text style={styles(colorScheme).removeButton}>✖</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderSongItem = ({ item }: { item: PlaylistItem }) => (
    <TouchableOpacity onPress={() => playSound(item, playlist.length)} style={styles(colorScheme).songItem}>
      <Image source={{ uri: item.artwork || 'default-image-uri' }} style={styles(colorScheme).artwork} />
      <View style={styles(colorScheme).songInfo}>
        <Text style={styles(colorScheme).songTitle}>{item.title}</Text>
        <Text style={styles(colorScheme).songArtist}>{item.artist}</Text>
      </View>
      <TouchableOpacity onPress={() => addToPlaylist(item)}>
        <Text style={styles(colorScheme).addToPlaylist}>+</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles(colorScheme).container}>
      <Text style={styles(colorScheme).title}>🎵 My Playlist 🎶</Text>
      <TextInput
        style={styles(colorScheme).searchInput}
        placeholder="Search Songs..."
        placeholderTextColor="#888"
        value={searchText}
        onChangeText={handleSearch}
      />
      <TouchableOpacity onPress={togglePlaylist} style={styles(colorScheme).toggleButton}>
        <Text style={styles(colorScheme).toggleButtonText}>
          {showPlaylist ? 'Hide Playlist' : 'Show Playlist'}
        </Text>
      </TouchableOpacity>

      {showPlaylist ? (
        <FlatList
          data={playlist}
          keyExtractor={(item) => item.id}
          renderItem={renderPlaylistItem}
          ListEmptyComponent={<Text style={styles(colorScheme).emptyText}>No tracks in playlist</Text>}
        />
      ) : (
        <FlatList data={filteredMusicFiles} keyExtractor={(item) => item.id} renderItem={renderSongItem} />
      )}

      {currentTrack && (
        <View style={styles(colorScheme).nowPlaying}>
          <Text style={styles(colorScheme).nowPlayingText}>Now Playing: {currentTrack.title}</Text>
          <View style={styles(colorScheme).controls}>
            <TouchableOpacity onPress={playPrevious}>
              <Text style={styles(colorScheme).controlIcon}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause}>
              <Text style={styles(colorScheme).controlIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={playNext}>
              <Text style={styles(colorScheme).controlIcon}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles(colorScheme).modalContainer}>
          <View style={styles(colorScheme).modalContent}>
            <Text style={styles(colorScheme).modalTitle}>{selectedTrack?.title}</Text>
            <Text style={styles(colorScheme).modalText}>Artist: {selectedTrack?.artist}</Text>
            <Text style={styles(colorScheme).modalText}>Album: {selectedTrack?.album}</Text>
            {selectedTrack?.artwork && (
              <Image source={{ uri: selectedTrack.artwork }} style={styles(colorScheme).modalArtwork} />
            )}
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles(colorScheme).closeButton}>
              <Text style={styles(colorScheme).closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TouchableOpacity onPress={() => navigation.goBack()} style={styles(colorScheme).backButton}>
        <Text style={styles(colorScheme).backButtonText}>Back to Player</Text>
      </TouchableOpacity>
    </View>
  );
}

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
    toggleButton: {
      backgroundColor: '#1a2b4d',
      padding: 12,
      borderRadius: 10,
      alignItems: 'center',
      marginBottom: 20,
    },
    toggleButtonText: {
      fontSize: 18,
      color: '#ffffff',
      fontWeight: '600',
    },
    songItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
      padding: 12,
      borderRadius: 10,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? '#1f2a40' : '#d0d0d0',
    },
    artwork: {
      width: 50,
      height: 50,
      borderRadius: 8,
    },
    songInfo: {
      flex: 1,
      marginLeft: 12,
    },
    songTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      fontWeight: '600',
    },
    songArtist: {
      fontSize: 14,
      color: scheme === 'dark' ? '#aaaaaa' : '#666',
    },
    addToPlaylist: {
      color: '#1e90ff',
      fontSize: 20,
      fontWeight: 'bold',
    },
    playlistItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
      padding: 12,
      borderRadius: 10,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? '#1f2a40' : '#d0d0d0',
    },
    playlistTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      fontWeight: '600',
    },
    removeButton: {
      color: '#ff6347',
      fontSize: 18,
      fontWeight: 'bold',
    },
    emptyText: {
      color: scheme === 'dark' ? '#aaaaaa' : '#666',
      textAlign: 'center',
      marginTop: 20,
    },
    nowPlaying: {
      backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#e0e0e0',
      padding: 10,
      borderRadius: 10,
      marginTop: 20,
      alignItems: 'center',
    },
    nowPlayingText: {
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      fontSize: 16,
      marginBottom: 10,
    },
    controls: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      width: '60%',
    },
    controlIcon: {
      fontSize: 30,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
    },
    modalContent: {
      backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
      padding: 20,
      borderRadius: 15,
      width: width * 0.85,
      alignItems: 'center',
    },
    modalTitle: {
      fontSize: 20,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      fontWeight: 'bold',
      marginBottom: 10,
    },
    modalText: {
      fontSize: 16,
      color: scheme === 'dark' ? '#aaaaaa' : '#666',
      marginVertical: 5,
    },
    modalArtwork: {
      width: 120,
      height: 120,
      borderRadius: 10,
      marginVertical: 15,
    },
    closeButton: {
      backgroundColor: '#ff6347',
      padding: 12,
      borderRadius: 10,
      marginTop: 15,
    },
    closeButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '600',
    },
    backButton: {
      backgroundColor: '#1a2b4d',
      padding: 12,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: 20,
    },
    backButtonText: {
      fontSize: 18,
      color: '#ffffff',
      fontWeight: '600',
    },
  });