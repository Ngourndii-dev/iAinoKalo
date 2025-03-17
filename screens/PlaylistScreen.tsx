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

const { width, height } = Dimensions.get('window');

interface PlaylistItem {
  id: string;
  uri: string;
  filename: string;
  title?: string;
  duration?: number;
  artist?: string;
  artwork?: string;
  album?: string;
}

const getOrientation = () => width > height ? 'landscape' : 'portrait';

export default function PlaylistScreen() {
  const colorScheme = useColorScheme();
  const [musicFiles, setMusicFiles] = useState<PlaylistItem[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [filteredMusicFiles, setFilteredMusicFiles] = useState<PlaylistItem[]>([]);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<PlaylistItem | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [searchText, setSearchText] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<PlaylistItem | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [orientation, setOrientation] = useState(getOrientation());
  const navigation = useNavigation();
  const notificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', () => {
      setOrientation(getOrientation());
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    Notifications.setNotificationCategoryAsync('musicControls', [
      { identifier: 'play-pause', buttonTitle: isPlaying ? 'Pause' : 'Play' },
      { identifier: 'next', buttonTitle: 'Next' },
      { identifier: 'previous', buttonTitle: 'Previous' },
    ]);

    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => subscription.remove();
  }, [isPlaying]);

  useEffect(() => {
    const initialize = async () => {
      const allAudio = await fetchAllAudioFiles();
      setMusicFiles(allAudio);
      setFilteredMusicFiles(allAudio);
      await loadPlaylist();
    };

    initialize();

    return () => {
      if (currentSound) currentSound.unloadAsync();
      if (notificationIdRef.current) Notifications.dismissNotificationAsync(notificationIdRef.current);
    };
  }, []);

  const fetchAllAudioFiles = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return [];

    let allAudioFiles: MediaLibrary.Asset[] = [];
    let media = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 100 });

    while (media.hasNextPage) {
      allAudioFiles = [...allAudioFiles, ...media.assets];
      media = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 100, after: media.endCursor });
    }
    allAudioFiles = [...allAudioFiles, ...media.assets];

    return Promise.all(
      allAudioFiles.map(async (item) => {
        const metadata = await MediaLibrary.getAssetInfoAsync(item.id);
        return {
          id: item.id,
          uri: item.uri,
          filename: item.filename,
          title: metadata.title || item.filename,
          duration: item.duration || 0,
          artist: metadata.artist,
          artwork: metadata.artwork,
          album: metadata.album,
        };
      })
    );
  };

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

  const addToPlaylist = (track: PlaylistItem) => {
    if (!playlist.some((item) => item.id === track.id)) {
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
        if (status.didJustFinish) {
          if (index < playlist.length - 1) playNext();
          else stopSound();
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
    if (currentIndex < playlist.length - 1) playSound(playlist[currentIndex + 1], currentIndex + 1);
  };

  const playPrevious = () => {
    if (currentIndex > 0) playSound(playlist[currentIndex - 1], currentIndex - 1);
  };

  const togglePlayPause = async () => {
    if (currentSound) {
      if (isPlaying) await currentSound.pauseAsync();
      else await currentSound.playAsync();
      setIsPlaying(!isPlaying);
      if (currentTrack) await updateNotification(currentTrack);
    }
  };

  const updateNotification = async (track: PlaylistItem) => {
    if (notificationIdRef.current) await Notifications.dismissNotificationAsync(notificationIdRef.current);

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: track.title,
        body: `Artist: ${track.artist || 'Unknown'} | ${isPlaying ? 'Playing' : 'Paused'}`,
        sound: true,
        data: { trackId: track.id },
        categoryIdentifier: 'musicControls',
      },
      trigger: null,
    });
    notificationIdRef.current = notificationId;
  };

  const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
    const action = response.actionIdentifier;

    if (action === 'play-pause') {
      togglePlayPause();
    } else if (action === 'next') {
      playNext();
    } else if (action === 'previous') {
      playPrevious();
    }
  };

  const handleSearch = (text: string) => {
    setSearchText(text);
    setFilteredMusicFiles(
      text
        ? musicFiles.filter((file) => file.title?.toLowerCase().includes(text.toLowerCase()))
        : musicFiles
    );
  };

  const renderPlaylistItem = ({ item, index }: { item: PlaylistItem; index: number }) => (
    <TouchableOpacity onPress={() => playSound(item, index)} style={styles(colorScheme, orientation).playlistItem}>
      <Text numberOfLines={1} style={styles(colorScheme, orientation).playlistTitle}>
        {item.title}
      </Text>
      <TouchableOpacity onPress={() => removeFromPlaylist(item.id)}>
        <Text style={styles(colorScheme, orientation).removeButton}>✖</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderSongItem = ({ item }: { item: PlaylistItem }) => (
    <TouchableOpacity
      onPress={() => {
        setSelectedTrack(item);
        setModalVisible(true);
      }}
      style={styles(colorScheme, orientation).songItem}
    >
      <Image
        source={{ uri: item.artwork || 'https://via.placeholder.com/50' }}
        style={styles(colorScheme, orientation).artwork}
      />
      <View style={styles(colorScheme, orientation).songInfo}>
        <Text numberOfLines={1} style={styles(colorScheme, orientation).songTitle}>
          {item.title}
        </Text>
        <Text style={styles(colorScheme, orientation).songArtist}>{item.artist || 'Unknown'}</Text>
      </View>
      <TouchableOpacity onPress={() => addToPlaylist(item)}>
        <Text style={styles(colorScheme, orientation).addToPlaylist}>+</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles(colorScheme, orientation).container}>
      <View style={styles(colorScheme, orientation).header}>
        <Text style={styles(colorScheme, orientation).title}>🎵 My Playlist 🎶</Text>
      </View>

      <TextInput
        style={styles(colorScheme, orientation).searchInput}
        placeholder="Search Songs..."
        placeholderTextColor={colorScheme === 'dark' ? '#aaaaaa' : '#666'}
        value={searchText}
        onChangeText={handleSearch}
      />

      <TouchableOpacity
        onPress={() => setShowPlaylist(!showPlaylist)}
        style={styles(colorScheme, orientation).toggleButton}
      >
        <Text style={styles(colorScheme, orientation).toggleButtonText}>
          {showPlaylist ? 'Show Songs' : 'Show Playlist'}
        </Text>
      </TouchableOpacity>

      <FlatList
        data={showPlaylist ? playlist : filteredMusicFiles}
        keyExtractor={(item) => item.id}
        renderItem={showPlaylist ? renderPlaylistItem : renderSongItem}
        ListEmptyComponent={
          <Text style={styles(colorScheme, orientation).emptyText}>
            {showPlaylist ? 'No tracks in playlist' : 'No songs found'}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: orientation === 'portrait' ? 120 : 80 }}
      />

      {currentTrack && (
        <View style={styles(colorScheme, orientation).nowPlaying}>
          <Text numberOfLines={1} style={styles(colorScheme, orientation).nowPlayingText}>
            Now Playing: {currentTrack.title}
          </Text>
          <View style={styles(colorScheme, orientation).controls}>
            <TouchableOpacity onPress={playPrevious}>
              <Text style={styles(colorScheme, orientation).controlIcon}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause}>
              <Text style={styles(colorScheme, orientation).controlIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={playNext}>
              <Text style={styles(colorScheme, orientation).controlIcon}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles(colorScheme, orientation).modalContainer}>
          <View style={styles(colorScheme, orientation).modalContent}>
            <Text style={styles(colorScheme, orientation).modalTitle}>{selectedTrack?.title}</Text>
            <Text style={styles(colorScheme, orientation).modalText}>Artist: {selectedTrack?.artist || 'Unknown'}</Text>
            <Text style={styles(colorScheme, orientation).modalText}>Album: {selectedTrack?.album || 'Unknown'}</Text>
            {selectedTrack?.artwork && (
              <Image
                source={{ uri: selectedTrack.artwork }}
                style={styles(colorScheme, orientation).modalArtwork}
              />
            )}
            <TouchableOpacity
              onPress={() => {
                if (selectedTrack) playSound(selectedTrack, playlist.length);
                setModalVisible(false);
              }}
              style={styles(colorScheme, orientation).playButton}
            >
              <Text style={styles(colorScheme, orientation).playButtonText}>Play</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setModalVisible(false)}
              style={styles(colorScheme, orientation).closeButton}
            >
              <Text style={styles(colorScheme, orientation).closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TouchableOpacity onPress={() => navigation.goBack()} style={styles(colorScheme, orientation).backButton}>
        <Text style={styles(colorScheme, orientation).backButtonText}>Back to Player</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (scheme: 'light' | 'dark' | null, orientation: 'portrait' | 'landscape') =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: scheme === 'dark' ? '#0f172a' : '#f8fafc',
      paddingHorizontal: orientation === 'portrait' ? 16 : 24,
      paddingTop: orientation === 'portrait' ? 40 : 20,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: orientation === 'portrait' ? 20 : 15,
    },
    title: {
      fontSize: orientation === 'portrait' ? 28 : 32,
      fontFamily: 'Poppins-Black',
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      flex: 1,
      textAlign: 'center',
    },
    searchInput: {
      height: 48,
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0',
      borderRadius: 12,
      paddingHorizontal: 16,
      marginBottom: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontSize: 16,
      fontFamily: 'Poppins-Medium',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    toggleButton: {
      backgroundColor: '#1e293b',
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      marginBottom: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
    },
    toggleButtonText: {
      fontSize: 16,
      color: '#ffffff',
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    songItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#ffffff',
      padding: 12,
      borderRadius: 12,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? '#3b82f6' : '#d0d0d0',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 2,
    },
    artwork: {
      width: 50,
      height: 50,
      borderRadius: 8,
      backgroundColor: '#eee',
    },
    songInfo: {
      flex: 1,
      marginLeft: 12,
    },
    songTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontFamily: 'Poppins-Regular',
      fontWeight: '600',
    },
    songArtist: {
      fontSize: 14,
      color: scheme === 'dark' ? '#9ca3af' : '#666',
      fontFamily: 'Poppins-Light',
    },
    addToPlaylist: {
      color: '#1e293b',
      fontSize: 24,
      fontFamily: 'Poppins-Medium',
      fontWeight: 'bold',
    },
    playlistItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#ffffff',
      padding: 12,
      borderRadius: 12,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? '#3b82f6' : '#d0d0d0',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 2,
    },
    playlistTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontFamily: 'Poppins-Regular',
      fontWeight: '600',
      flex: 1,
      marginRight: 10,
    },
    removeButton: {
      color: '#ff6347',
      fontSize: 18,
      fontFamily: 'Poppins-SemiBold',
      fontWeight: 'bold',
    },
    emptyText: {
      color: scheme === 'dark' ? '#9ca3af' : '#666',
      textAlign: 'center',
      marginTop: 20,
      fontSize: 16,
      fontFamily: 'Poppins-Light',
    },
    nowPlaying: {
      position: 'absolute',
      bottom: orientation === 'portrait' ? 70 : 40,
      left: 16,
      right: 16,
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#dbeafe',
      padding: 12,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 5,
    },
    nowPlayingText: {
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontSize: 16,
      marginBottom: 8,
      fontFamily: 'Poppins-Medium',
      fontWeight: '600',
      maxWidth: '90%',
    },
    controls: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      width: '60%',
    },
    controlIcon: {
      fontSize: 32,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontFamily: 'Poppins-Medium',
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
    },
    modalContent: {
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#ffffff',
      padding: 20,
      borderRadius: 15,
      width: width * (orientation === 'portrait' ? 0.9 : 0.7),
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 5,
      elevation: 5,
    },
    modalTitle: {
      fontSize: 20,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontFamily: 'Poppins-Bold',
      fontWeight: '700',
      marginBottom: 10,
      textAlign: 'center',
    },
    modalText: {
      fontSize: 16,
      color: scheme === 'dark' ? '#9ca3af' : '#666',
      fontFamily: 'Poppins-Regular',
      marginVertical: 5,
    },
    modalArtwork: {
      width: 150,
      height: 150,
      borderRadius: 12,
      marginVertical: 15,
    },
    playButton: {
      backgroundColor: '#1e293b',
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 10,
      marginTop: 15,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 2,
    },
    playButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    closeButton: {
      backgroundColor: '#ff6347',
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 10,
      marginTop: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 2,
    },
    closeButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    backButton: {
      position: 'absolute',
      bottom: 20,
      left: 16,
      right: 16,
      backgroundColor: '#1e293b',
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
    },
    backButtonText: {
      fontSize: 16,
      color: '#ffffff',
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
  });