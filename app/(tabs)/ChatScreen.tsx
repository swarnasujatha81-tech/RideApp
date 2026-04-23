import { Audio } from 'expo-av';
import { addDoc, collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { db } from '../../lib/firebase';

type ChatRouteParams = {
  rideId: string;
  userId: string;
  senderRole?: 'USER' | 'DRIVER';
  senderName?: string;
};

type ChatMessage = {
  text: string;
  senderId?: string;
  sender?: string;
  senderRole?: 'USER' | 'DRIVER';
  senderName?: string;
  createdAt: number;
};

type ChatScreenProps = {
  route: {
    params: ChatRouteParams;
  };
};

export default function ChatScreen({ route }: ChatScreenProps) {
  const { rideId, userId, senderRole = 'USER', senderName } = route.params;

  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const playChatSound = async () => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://actions.google.com/sounds/v1/cartoon/pop.ogg' },
        { shouldPlay: true, volume: 1 }
      );

      setTimeout(async () => {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore unload errors for short UI sounds
        }
      }, 1200);
    } catch {
      // ignore chat sound failures so chat always works
    }
  };

  useEffect(() => {
    if (!rideId) return;

    const q = query(
      collection(db, 'rides', rideId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(q, snap => {
      setMessages(
        snap.docs.map(d => d.data() as ChatMessage).sort((a, b) => a.createdAt - b.createdAt)
      );
    });

    return unsub;
  }, [rideId]);

  const sendMessage = async () => {
    if (!rideId || !userId) {
      Alert.alert('Chat unavailable', 'Please reopen the ride chat and try again.');
      return;
    }

    const text = msg.trim();
    if (!text) return;

    try {
      const payload: Record<string, unknown> = {
        text,
        senderId: userId,
        sender: userId,
        senderRole,
        createdAt: Date.now(),
      };

      const trimmedSenderName = senderName?.trim();
      if (trimmedSenderName) payload.senderName = trimmedSenderName;

      await addDoc(collection(db, 'rides', rideId, 'messages'), payload);

      playChatSound();
      setMsg('');
    } catch {
      Alert.alert('Message not sent', 'Could not send the message right now. Please try again.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#E8F5E9' }}>
      <FlatList
        data={messages}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <Text style={{
            alignSelf: (item.senderId || item.sender) === userId ? 'flex-end' : 'flex-start',
            backgroundColor: '#fff',
            margin: 6,
            padding: 10,
            borderRadius: 12,
            maxWidth: '70%'
          }}>
            {item.text}
          </Text>
        )}
      />

      <View style={{ flexDirection: 'row', padding: 10 }}>
        <TextInput
          value={msg}
          onChangeText={setMsg}
          placeholder="Type message..."
          style={{
            flex: 1,
            backgroundColor: '#fff',
            borderRadius: 20,
            paddingHorizontal: 15
          }}
        />

        <TouchableOpacity onPress={sendMessage}>
          <Text style={{ marginLeft: 10, color: 'green', fontWeight: 'bold' }}>
            Send
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}