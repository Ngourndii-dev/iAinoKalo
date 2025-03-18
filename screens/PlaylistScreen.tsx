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

interface Playlist {
  id: string;
  title: string;
  tracks: PlaylistItem[];
}

const getOrientation = () => (width > height ? 'landscape' : 'portrait');

export default function PlaylistScreen() {
  const colorScheme = useColorScheme();
  const [musicFiles, setMusicFiles] = useState<PlaylistItem[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [filteredMusicFiles, setFilteredMusicFiles] = useState<PlaylistItem[]>([]);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<PlaylistItem | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [searchText, setSearchText] = useState('');
  const [songModalVisible, setSongModalVisible] = useState(false);
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<PlaylistItem | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
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
      await loadPlaylists();
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

  const loadPlaylists = async () => {
    try {
      const savedPlaylists = await AsyncStorage.getItem('playlists');
      if (savedPlaylists) setPlaylists(JSON.parse(savedPlaylists));
    } catch (error) {
      console.error('Failed to load playlists', error);
    }
  };

  const savePlaylists = async (updatedPlaylists: Playlist[]) => {
    try {
      await AsyncStorage.setItem('playlists', JSON.stringify(updatedPlaylists));
      setPlaylists(updatedPlaylists);
    } catch (error) {
      console.error('Failed to save playlists', error);
    }
  };

  const createPlaylist = () => {
    if (newPlaylistTitle.trim()) {
      const newPlaylist: Playlist = {
        id: Date.now().toString(),
        title: newPlaylistTitle.trim(),
        tracks: [],
      };
      savePlaylists([...playlists, newPlaylist]);
      setNewPlaylistTitle('');
      setCreateModalVisible(false);
    }
  };

  const deletePlaylist = (playlistId: string) => {
    const updatedPlaylists = playlists.filter((playlist) => playlist.id !== playlistId);
    savePlaylists(updatedPlaylists);
    if (selectedPlaylist?.id === playlistId) {
      setSelectedPlaylist(null);
      setPlaylistModalVisible(false);
    }
  };

  const addToPlaylist = (track: PlaylistItem, playlistId: string) => {
    const updatedPlaylists = playlists.map((playlist) => {
      if (playlist.id === playlistId && !playlist.tracks.some((t) => t.id === track.id)) {
        return { ...playlist, tracks: [...playlist.tracks, track] };
      }
      return playlist;
    });
    savePlaylists(updatedPlaylists);
  };

  const removeFromPlaylist = (trackId: string, playlistId: string) => {
    const updatedPlaylists = playlists.map((playlist) => {
      if (playlist.id === playlistId) {
        return { ...playlist, tracks: playlist.tracks.filter((t) => t.id !== trackId) };
      }
      return playlist;
    });
    savePlaylists(updatedPlaylists);
    if (currentTrack?.id === trackId) stopSound();
  };

  const editPlaylistTitle = (playlistId: string, newTitle: string) => {
    const updatedPlaylists = playlists.map((playlist) => {
      if (playlist.id === playlistId) {
        return { ...playlist, title: newTitle.trim() };
      }
      return playlist;
    });
    savePlaylists(updatedPlaylists);
    setEditModalVisible(false);
  };

  const playSound = async (track: PlaylistItem, index: number, playlist: PlaylistItem[]) => {
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
          if (index < playlist.length - 1) playNext(playlist);
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

  const playNext = (playlist: PlaylistItem[]) => {
    if (currentIndex < playlist.length - 1) playSound(playlist[currentIndex + 1], currentIndex + 1, playlist);
  };

  const playPrevious = (playlist: PlaylistItem[]) => {
    if (currentIndex > 0) playSound(playlist[currentIndex - 1], currentIndex - 1, playlist);
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
    const currentPlaylist = selectedPlaylist?.tracks || [];

    if (action === 'play-pause') {
      togglePlayPause();
    } else if (action === 'next') {
      playNext(currentPlaylist);
    } else if (action === 'previous') {
      playPrevious(currentPlaylist);
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
    <View style={styles(colorScheme, orientation).playlistTrackItem}>
      <TouchableOpacity
        onPress={() => selectedPlaylist && playSound(item, index, selectedPlaylist.tracks)}
        style={styles(colorScheme, orientation).playlistTrackContent}
      >
        <Image
          source={{ uri: item.artwork || 'https://via.placeholder.com/40' }}
          style={styles(colorScheme, orientation).trackArtwork}
        />
        <View style={styles(colorScheme, orientation).trackInfo}>
          <Text numberOfLines={1} style={styles(colorScheme, orientation).trackTitle}>
            {item.title}
          </Text>
          <Text style={styles(colorScheme, orientation).trackArtist}>
            {item.artist || 'Unknown'}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => selectedPlaylist && removeFromPlaylist(item.id, selectedPlaylist.id)}
        style={styles(colorScheme, orientation).actionButton}
      >
        <Text style={styles(colorScheme, orientation).actionButtonText}>✖</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSongItem = ({ item }: { item: PlaylistItem }) => (
    <TouchableOpacity
      onPress={() => {
        setSelectedTrack(item);
        setSongModalVisible(true);
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
        <Text style={styles(colorScheme, orientation).songArtist}>
          {item.artist || 'Unknown'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderPlaylist = ({ item }: { item: Playlist }) => (
    <View style={styles(colorScheme, orientation).playlistCard}>
      <TouchableOpacity
        onPress={() => {
          setSelectedPlaylist(item);
          setPlaylistModalVisible(true);
        }}
        style={styles(colorScheme, orientation).playlistContent}
      >
        <Text numberOfLines={1} style={styles(colorScheme, orientation).playlistTitle}>
          {item.title}
        </Text>
        <Text style={styles(colorScheme, orientation).playlistSubtitle}>
          {item.tracks.length} tracks
        </Text>
      </TouchableOpacity>
      <View style={styles(colorScheme, orientation).playlistActions}>
        <TouchableOpacity
          onPress={() => {
            setSelectedPlaylist(item);
            setEditModalVisible(true);
          }}
          style={styles(colorScheme, orientation).actionButton}
        >
          <Text style={styles(colorScheme, orientation).actionButtonText}>✎</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => deletePlaylist(item.id)}
          style={styles(colorScheme, orientation).actionButton}
        >
          <Text style={styles(colorScheme, orientation).actionButtonText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles(colorScheme, orientation).container}>
      <View style={styles(colorScheme, orientation).header}>
        <Text style={styles(colorScheme, orientation).title}>🎵 My Playlists 🎶</Text>
      </View>

      <TextInput
        style={styles(colorScheme, orientation).searchInput}
        placeholder="Search Songs..."
        placeholderTextColor={colorScheme === 'dark' ? '#aaaaaa' : '#666666'}
        value={searchText}
        onChangeText={handleSearch}
      />

      <View style={styles(colorScheme, orientation).buttonContainer}>
        <TouchableOpacity
          onPress={() => setShowPlaylists(!showPlaylists)}
          style={styles(colorScheme, orientation).toggleButton}
        >
          <Text style={styles(colorScheme, orientation).toggleButtonText}>
            {showPlaylists ? 'Show Songs' : 'Show Playlists'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setCreateModalVisible(true)}
          style={styles(colorScheme, orientation).createButton}
        >
          <Text style={styles(colorScheme, orientation).toggleButtonText}>+ New Playlist</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={showPlaylists ? playlists : filteredMusicFiles}
        keyExtractor={(item) => item.id}
        renderItem={showPlaylists ? renderPlaylist : renderSongItem}
        ListEmptyComponent={
          <Text style={styles(colorScheme, orientation).emptyText}>
            {showPlaylists ? 'No playlists created yet' : 'No songs found'}
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
            <TouchableOpacity onPress={() => playPrevious(selectedPlaylist?.tracks || [])}>
              <Text style={styles(colorScheme, orientation).controlIcon}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause}>
              <Text style={styles(colorScheme, orientation).controlIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => playNext(selectedPlaylist?.tracks || [])}>
              <Text style={styles(colorScheme, orientation).controlIcon}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Song Details Modal */}
      <Modal visible={songModalVisible} transparent animationType="slide" onRequestClose={() => setSongModalVisible(false)}>
        <View style={styles(colorScheme, orientation).modalOverlay}>
          <View style={styles(colorScheme, orientation).modalCard}>
            <Text style={styles(colorScheme, orientation).modalTitle}>{selectedTrack?.title}</Text>
            <Text style={styles(colorScheme, orientation).modalSubtitle}>
              Artist: {selectedTrack?.artist || 'Unknown'}
            </Text>
            <Text style={styles(colorScheme, orientation).modalSubtitle}>
              Album: {selectedTrack?.album || 'Unknown'}
            </Text>
            {selectedTrack?.artwork && (
              <Image source={{ uri: selectedTrack.artwork }} style={styles(colorScheme, orientation).modalArtwork} />
            )}
            {playlists.map((playlist) => (
              <TouchableOpacity
                key={playlist.id}
                onPress={() => {
                  if (selectedTrack) addToPlaylist(selectedTrack, playlist.id);
                  setSongModalVisible(false);
                }}
                style={styles(colorScheme, orientation).actionButtonSecondary}
              >
                <Text style={styles(colorScheme, orientation).actionButtonText}>Add to {playlist.title}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setSongModalVisible(false)}
              style={styles(colorScheme, orientation).closeButton}
            >
              <Text style={styles(colorScheme, orientation).closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create Playlist Modal */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles(colorScheme, orientation).modalOverlay}>
          <View style={styles(colorScheme, orientation).modalCard}>
            <Text style={styles(colorScheme, orientation).modalTitle}>Create New Playlist</Text>
            <TextInput
              style={styles(colorScheme, orientation).modalInput}
              placeholder="Playlist Title"
              placeholderTextColor={colorScheme === 'dark' ? '#aaaaaa' : '#666666'}
              value={newPlaylistTitle}
              onChangeText={setNewPlaylistTitle}
            />
            <View style={styles(colorScheme, orientation).modalButtonContainer}>
              <TouchableOpacity
                onPress={createPlaylist}
                style={styles(colorScheme, orientation).actionButtonPrimary}
              >
                <Text style={styles(colorScheme, orientation).actionButtonText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setCreateModalVisible(false)}
                style={styles(colorScheme, orientation).actionButtonSecondary}
              >
                <Text style={styles(colorScheme, orientation).actionButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Playlist Modal */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles(colorScheme, orientation).modalOverlay}>
          <View style={styles(colorScheme, orientation).modalCard}>
            <Text style={styles(colorScheme, orientation).modalTitle}>Edit Playlist</Text>
            <TextInput
              style={styles(colorScheme, orientation).modalInput}
              placeholder="New Playlist Title"
              placeholderTextColor={colorScheme === 'dark' ? '#aaaaaa' : '#666666'}
              value={selectedPlaylist?.title}
              onChangeText={(text) => setSelectedPlaylist((prev) => (prev ? { ...prev, title: text } : null))}
            />
            <View style={styles(colorScheme, orientation).modalButtonContainer}>
              <TouchableOpacity
                onPress={() => selectedPlaylist && editPlaylistTitle(selectedPlaylist.id, selectedPlaylist.title)}
                style={styles(colorScheme, orientation).actionButtonPrimary}
              >
                <Text style={styles(colorScheme, orientation).actionButtonText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setEditModalVisible(false)}
                style={styles(colorScheme, orientation).actionButtonSecondary}
              >
                <Text style={styles(colorScheme, orientation).actionButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Playlist Content Modal */}
      <Modal
        visible={playlistModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPlaylistModalVisible(false)}
      >
        <View style={styles(colorScheme, orientation).modalOverlay}>
          <View style={styles(colorScheme, orientation).modalCardLarge}>
            <Text style={styles(colorScheme, orientation).modalTitle}>{selectedPlaylist?.title}</Text>
            <Text style={styles(colorScheme, orientation).modalSubtitle}>
              {selectedPlaylist?.tracks.length} tracks
            </Text>
            <FlatList
              data={selectedPlaylist?.tracks}
              keyExtractor={(item) => item.id}
              renderItem={renderPlaylistItem}
              ListEmptyComponent={<Text style={styles(colorScheme, orientation).emptyText}>No tracks in this playlist</Text>}
              style={styles(colorScheme, orientation).trackList}
            />
            <TouchableOpacity
              onPress={() => setPlaylistModalVisible(false)}
              style={styles(colorScheme, orientation).closeButton}
            >
              <Text style={styles(colorScheme, orientation).closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

     
      <TouchableOpacity
        onPress={() => navigation.navigate('MusicPlayerScreen')}
        style={styles(colorScheme, orientation).backButton}
      >
        <Text style={styles(colorScheme, orientation).backButtonText}>All Music</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (scheme: 'light' | 'dark' | null, orientation: 'portrait' | 'landscape') =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: scheme === 'dark' ? '#0f172a' : '#f1f5f9',
      paddingHorizontal: orientation === 'portrait' ? 16 : 24,
      paddingTop: orientation === 'portrait' ? 50 : 30,
    },
    header: {
      marginBottom: orientation === 'portrait' ? 24 : 18,
      alignItems: 'center',
    },
    title: {
      fontSize: orientation === 'portrait' ? 32 : 36,
      fontFamily: 'Poppins-Black',
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      textAlign: 'center',
    },
    searchInput: {
      height: 50,
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0', 
      borderRadius: 15,
      paddingHorizontal: 20,
      marginBottom: 20,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontSize: 16,
      fontFamily: 'Poppins-Medium',
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 6,
      elevation: 3,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    toggleButton: {
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0', 
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      width: '48%',
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 4,
    },
    createButton: {
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0', 
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      width: '48%',
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 4,
    },
    toggleButtonText: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    songItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0', 
      padding: 14,
      borderRadius: 15,
      marginVertical: 8,
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    artwork: {
      width: 50,
      height: 50,
      borderRadius: 10,
      backgroundColor: scheme === 'dark' ? '#000000' : '#d1d5db', 
    },
    songInfo: {
      flex: 1,
      marginLeft: 12,
    },
    songTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    songArtist: {
      fontSize: 14,
      color: scheme === 'dark' ? '#d1d5db' : '#64748b', 
      fontFamily: 'Poppins-Regular',
    },
    playlistCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0', 
      padding: 16,
      borderRadius: 15,
      marginVertical: 8,
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    playlistContent: {
      flex: 1,
    },
    playlistTitle: {
      fontSize: 18,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    playlistSubtitle: {
      fontSize: 14,
      color: scheme === 'dark' ? '#d1d5db' : '#64748b', 
      fontFamily: 'Poppins-Regular',
    },
    playlistActions: {
      flexDirection: 'row',
      gap: 10,
    },
    playlistTrackItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: scheme === 'dark' ? '#334155' : '#d1d5db',
    },
    playlistTrackContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    trackArtwork: {
      width: 40,
      height: 40,
      borderRadius: 8,
      marginRight: 12,
    },
    trackInfo: {
      flex: 1,
    },
    trackTitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontFamily: 'Poppins-Medium',
    },
    trackArtist: {
      fontSize: 14,
      color: scheme === 'dark' ? '#d1d5db' : '#64748b', 
      fontFamily: 'Poppins-Regular',
    },
    actionButton: {
      padding: 8,
    },
    actionButtonText: {
      fontSize: 18,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontFamily: 'Poppins-SemiBold',
    },
    emptyText: {
      color: scheme === 'dark' ? '#d1d5db' : '#64748b', 
      textAlign: 'center',
      marginTop: 20,
      fontSize: 16,
      fontFamily: 'Poppins-Regular',
    },
    nowPlaying: {
      position: 'absolute',
      bottom: orientation === 'portrait' ? 70 : 40,
      left: 16,
      right: 16,
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0', 
      padding: 14,
      borderRadius: 15,
      alignItems: 'center',
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 5,
    },
    nowPlayingText: {
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontSize: 16,
      marginBottom: 10,
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
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: scheme === 'dark' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(107, 114, 128, 0.7)',
    },
    modalCard: {
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#ffffff',
      padding: 24,
      borderRadius: 20,
      width: width * (orientation === 'portrait' ? 0.9 : 0.7),
      alignItems: 'center',
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 8,
    },
    modalCardLarge: {
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#ffffff', 
      padding: 24,
      borderRadius: 20,
      width: width * (orientation === 'portrait' ? 0.9 : 0.7),
      height: height * (orientation === 'portrait' ? 0.8 : 0.6),
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 8,
    },
    modalTitle: {
      fontSize: 24,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontFamily: 'Poppins-Bold',
      fontWeight: '700',
      marginBottom: 12,
      textAlign: 'center',
    },
    modalSubtitle: {
      fontSize: 16,
      color: scheme === 'dark' ? '#d1d5db' : '#64748b', 
      fontFamily: 'Poppins-Regular',
      marginBottom: 12,
    },
    modalArtwork: {
      width: 150,
      height: 150,
      borderRadius: 15,
      marginBottom: 20,
    },
    modalInput: {
      width: '100%',
      height: 50,
      backgroundColor: scheme === 'dark' ? '#0f172a' : '#f1f5f9', 
      borderRadius: 12,
      paddingHorizontal: 16,
      marginBottom: 20,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontSize: 16,
      fontFamily: 'Poppins-Medium',
    },
    modalButtonContainer: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
      justifyContent: 'center',
    },
    actionButtonPrimary: {
      backgroundColor: scheme === 'dark' ? '#2563eb' : '#3b82f6', 
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 12,
      flex: 1,
      alignItems: 'center',
    },
    actionButtonSecondary: {
      backgroundColor: scheme === 'dark' ? '#0f172a' : '#e2e8f0', 
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 12,
      flex: 1,
      alignItems: 'center',
    },
    actionButtonText: {
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontSize: 16,
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    closeButton: {
      backgroundColor: scheme === 'dark' ? '#000000' : '#d1d5db', 
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 12,
      marginTop: 20,
      width: '100%',
      alignItems: 'center',
    },
    closeButtonText: {
      color: scheme === 'dark' ? '#ffffff' : '#1e293b', 
      fontSize: 16,
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
    trackList: {
      width: '100%',
      flex: 1,
    },
    backButton: {
      position: 'absolute',
      bottom: 20,
      left: 16,
      right: 16,
      backgroundColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0',
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: scheme === 'dark' ? '#000000' : '#aaaaaa', 
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 4,
    },
    backButtonText: {
      fontSize: 16,
      color: scheme === 'dark' ? '#ffffff' : '#1e293b',
      fontFamily: 'Poppins-SemiBold',
      fontWeight: '600',
    },
  });