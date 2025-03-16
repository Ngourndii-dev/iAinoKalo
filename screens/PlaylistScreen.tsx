import React, { useEffect, useState } from 'react';
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
  AppState,
} from 'react-native';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Permissions from 'expo-permissions';

const { width, height } = Dimensions.get('window');

interface PlaylistItem {
  id: string;
  uri: string;
  filename: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
}

export default function PlaylistScreen() {
  const colorScheme = useColorScheme();
  const [musicFiles, setMusicFiles] = useState<PlaylistItem[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [filteredMusicFiles, setFilteredMusicFiles] = useState<PlaylistItem[]>([]);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<PlaylistItem | null>(null);
  const navigation = useNavigation();
  const [searchText, setSearchText] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<PlaylistItem | null>(null);

  // Configure notifications
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    // Request permissions
    (async () => {
      const { status: audioStatus } = await Audio.requestPermissionsAsync();
      const { status: notificationStatus } = await Notifications.requestPermissionsAsync();
      if (audioStatus !== 'granted' || notificationStatus !== 'granted') {
        alert('Permissions not granted!');
      }
    })();

    // Handle notification responses
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => subscription.remove();
  }, []);

  // Load music files and playlist
  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') {
        const media = await MediaLibrary.getAssetsAsync({ mediaType: 'audio' });
        const files = await Promise.all(
          media.assets.map(async (item) => {
            const metadata = await MediaLibrary.getAssetInfoAsync(item.id);
            return {
              id: item.id,
              uri: item.uri,
              filename: item.filename,
              title: metadata.title || item.filename,
              artist: metadata.artist || 'Unknown Artist',
              album: metadata.album || 'Unknown Album',
              artwork: metadata.artwork || null,
            };
          })
        );
        setMusicFiles(files);
        setFilteredMusicFiles(files);
      }

      loadPlaylist();
    })();

    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, []);

  // Handle search
  const handleSearch = (text: string) => {
    setSearchText(text);
    if (text) {
      const filtered = musicFiles.filter((file) => file.title?.toLowerCase().includes(text.toLowerCase()));
      setFilteredMusicFiles(filtered);
    } else {
      setFilteredMusicFiles(musicFiles);
    }
  };

  // Save playlist to AsyncStorage
  const savePlaylist = async (playlist: PlaylistItem[]) => {
    try {
      await AsyncStorage.setItem('playlist', JSON.stringify(playlist));
    } catch (error) {
      console.error('Failed to save playlist', error);
    }
  };

  // Load playlist from AsyncStorage
  const loadPlaylist = async () => {
    try {
      const savedPlaylist = await AsyncStorage.getItem('playlist');
      if (savedPlaylist) {
        setPlaylist(JSON.parse(savedPlaylist));
      }
    } catch (error) {
      console.error('Failed to load playlist', error);
    }
  };

  // Play sound
  const playSound = async (track: PlaylistItem) => {
    try {
      if (currentSound) {
        await currentSound.unloadAsync();
      }

      // Configure audio for background playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true, // Enable background playback
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: track.uri },
        { shouldPlay: true }
      );

      setCurrentSound(sound);
      setCurrentTrack(track);
      setIsPlaying(true);
      await sound.playAsync();

      // Show interactive notification
      await showNotification(track);
    } catch (error) {
      console.error('Failed to play sound', error);
    }
  };

  // Add track to playlist
  const addToPlaylist = (track: PlaylistItem) => {
    if (!playlist.find((item) => item.id === track.id)) {
      const newPlaylist = [...playlist, track];
      setPlaylist(newPlaylist);
      savePlaylist(newPlaylist);
    }
  };

  // Remove track from playlist
  const removeFromPlaylist = (trackId: string) => {
    const newPlaylist = playlist.filter((item) => item.id !== trackId);
    setPlaylist(newPlaylist);
    savePlaylist(newPlaylist);
  };

  // Show metadata modal
  const openMetadataModal = (track: PlaylistItem) => {
    setSelectedTrack(track);
    setModalVisible(true);
  };

  // Show interactive notification
  const showNotification = async (track: PlaylistItem) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: track.title,
        body: track.artist,
        sound: true,
        data: { trackId: track.id },
        actions: [
          {
            identifier: 'play-pause',
            title: isPlaying ? 'Pause' : 'Play',
          },
          {
            identifier: 'next',
            title: 'Next',
          },
          {
            identifier: 'previous',
            title: 'Previous',
          },
        ],
      },
      trigger: null, // Immediately
    });
  };

  // Handle notification responses
  const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
    const actionIdentifier = response.actionIdentifier;
    const trackId = response.notification.request.content.data.trackId;
    const track = musicFiles.find((item) => item.id === trackId);

    if (track) {
      switch (actionIdentifier) {
        case 'play-pause':
          if (isPlaying) {
            currentSound?.pauseAsync();
            setIsPlaying(false);
          } else {
            currentSound?.playAsync();
            setIsPlaying(true);
          }
          break;
        case 'next':
          // Implement logic for next track
          break;
        case 'previous':
          // Implement logic for previous track
          break;
        default:
          playSound(track);
          break;
      }
    }
  };

  // Render song item
  const renderSongItem = ({ item }: { item: PlaylistItem }) => (
    <TouchableOpacity onPress={() => playSound(item)} style={styles(colorScheme).songItem}>
      <Image source={{ uri: item.artwork || 'default-image-uri' }} style={styles(colorScheme).artwork} />
      <View style={styles(colorScheme).songInfo}>
        <Text style={styles(colorScheme).songTitle}>{item.title}</Text>
        <Text style={styles(colorScheme).songArtist}>{item.artist}</Text>
        <Text style={styles(colorScheme).songAlbum}>{item.album}</Text>
      </View>
      <TouchableOpacity onPress={() => addToPlaylist(item)}>
        <Text style={styles(colorScheme).addToPlaylist}>Add</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => openMetadataModal(item)}>
        <Text style={styles(colorScheme).viewMetadata}>View Metadata</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles(colorScheme).container}>
      <Text style={styles(colorScheme).title}>🎵 Playlist 🎶</Text>
      <TextInput
        style={styles(colorScheme).searchInput}
        placeholder="Search Songs..."
        value={searchText}
        onChangeText={handleSearch}
      />
      <FlatList
        data={filteredMusicFiles}
        keyExtractor={(item) => item.id}
        renderItem={renderSongItem}
        contentContainerStyle={styles(colorScheme).listContent}
      />

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
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

// Styles
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
    listContent: {
      paddingBottom: 20,
    },
    songItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
      padding: 12,
      borderRadius: 10,
      marginVertical: 8,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? '#1f2a40' : '#d0d0d0',
      shadowColor: scheme === 'dark' ? '#000' : '#ccc',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.5,
      shadowRadius: 4,
      elevation: 6,
    },
    artwork: {
      width: 50,
      height: 50,
      borderRadius: 8,
    },
    songInfo: {
      flex: 1,
      marginLeft: 10,
    },
    songTitle: {
      fontSize: 18,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      fontWeight: '600',
    },
    songArtist: {
      fontSize: 14,
      color: scheme === 'dark' ? '#888' : '#666',
    },
    songAlbum: {
      fontSize: 14,
      color: scheme === 'dark' ? '#888' : '#666',
    },
    addToPlaylist: {
      color: scheme === 'dark' ? '#1e90ff' : '#007bff',
      fontSize: 14,
      marginRight: 10,
    },
    viewMetadata: {
      color: scheme === 'dark' ? '#ff6347' : '#ff4500',
      fontSize: 14,
      fontWeight: 'bold',
    },
    backButton: {
      marginTop: 20,
      padding: 10,
      backgroundColor: scheme === 'dark' ? '#1a2b4d' : '#e0e0e0',
      borderRadius: 10,
      alignItems: 'center',
    },
    backButtonText: {
      fontSize: 18,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: scheme === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.4)',
    },
    modalContent: {
      backgroundColor: scheme === 'dark' ? '#121826' : '#ffffff',
      padding: 20,
      borderRadius: 10,
      width: width * 0.8,
      alignItems: 'center',
    },
    modalTitle: {
      fontSize: 22,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      marginBottom: 10,
    },
    modalText: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#000000',
      marginVertical: 5,
    },
    modalArtwork: {
      width: 100,
      height: 100,
      borderRadius: 10,
      marginVertical: 10,
    },
    closeButton: {
      backgroundColor: scheme === 'dark' ? '#ff6347' : '#ff4500',
      padding: 10,
      borderRadius: 8,
      marginTop: 10,
    },
    closeButtonText: {
      color: '#ffffff',
      fontSize: 16,
    },
  });