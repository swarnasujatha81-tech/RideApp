import { collection, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { db } from '../firebase';

type HistoryRouteParams = {
  userId: string;
};

type RideHistoryItem = {
  pickupAddr: string;
  dropAddr: string;
  status: string;
};

type HistoryScreenProps = {
  route: {
    params: HistoryRouteParams;
  };
};

export default function HistoryScreen({ route }: HistoryScreenProps) {
  const { userId } = route.params;

  const [rides, setRides] = useState<RideHistoryItem[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, 'rides'),
      where('driverId', '==', userId)
    );

    const unsub = onSnapshot(q, snap => {
      setRides(snap.docs.map(d => d.data() as RideHistoryItem));
    });

    return unsub;
  }, []);

  return (
    <View style={{ flex: 1, padding: 10 }}>
      <FlatList
        data={rides}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <View style={{
            backgroundColor: '#fff',
            padding: 10,
            marginBottom: 10,
            borderRadius: 10
          }}>
            <Text>{item.pickupAddr} → {item.dropAddr}</Text>
            <Text>Status: {item.status}</Text>
          </View>
        )}
      />
    </View>
  );
}