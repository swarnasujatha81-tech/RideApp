import { collection, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { db } from '../../lib/firebase';

type HistoryRouteParams = {
  userId: string;
  role?: 'driver' | 'passenger';
};

type HistoryScreenProps = {
  route: {
    params: HistoryRouteParams;
  };
};

interface RideHistoryItem {
  id?: string;
  rideId: string;
  rideType: string;
  pickupAddr?: string;
  dropAddr?: string;
  fare: number;
  status: 'completed' | 'cancelled';
  cancelledBy?: 'DRIVER' | 'PASSENGER';
  driverId?: string;
  driverName?: string;
  passengerId?: string;
  passengerName?: string;
  distance?: number;
  pickupTimeMs?: number;
  dropTimeMs?: number;
  totalTimeMinutes?: number;
  createdAt?: any;
};

export default function HistoryScreen({ route }: HistoryScreenProps) {
  const { userId, role = 'driver' } = route.params;

  const [rides, setRides] = useState<RideHistoryItem[]>([]);

  useEffect(() => {
    const field = role === 'driver' ? 'driverId' : 'passengerId';
    const q = query(
      collection(db, 'rideHistory'),
      where(field, '==', userId)
    );

    return onSnapshot(q, snap => {
      const history: RideHistoryItem[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as RideHistoryItem));
      history.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setRides(history);
    });
  }, [userId, role]);

  return (
    <View style={{ flex: 1, padding: 10 }}>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id || ''}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#666', padding: 40 }}>No ride history yet</Text>}
        renderItem={({ item }) => (
          <View style={{
            backgroundColor: '#fff',
            padding: 16,
            marginBottom: 12,
            borderRadius: 16,
            borderLeftWidth: 4,
            borderLeftColor: item.status === 'completed' ? '#34C759' : '#FF3B30'
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontWeight: 'bold', fontSize: 16 }}>{item.pickupAddr || 'Pickup'} → {item.dropAddr || 'Drop'}</Text>
              <Text style={{ color: item.status === 'completed' ? '#34C759' : '#FF3B30', fontWeight: 'bold' }}>
                {item.status.toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: '#666', marginBottom: 4 }}>₹{item.fare} • {item.rideType}</Text>
            {typeof item.distance === 'number' && <Text style={{ color: '#666', fontSize: 12 }}>Distance: {item.distance.toFixed(1)} km</Text>}
            {typeof item.totalTimeMinutes === 'number' && <Text style={{ color: '#666', fontSize: 12 }}>Time: {item.totalTimeMinutes} min</Text>}
            {item.pickupTimeMs && <Text style={{ color: '#666', fontSize: 12 }}>Pickup: {new Date(item.pickupTimeMs).toLocaleString()}</Text>}
            {item.dropTimeMs && <Text style={{ color: '#666', fontSize: 12 }}>Drop: {new Date(item.dropTimeMs).toLocaleString()}</Text>}
            {item.cancelledBy && (
              <Text style={{ color: '#FF6B35', fontSize: 12 }}>Cancelled by {item.cancelledBy}</Text>
            )}
            {item.driverName && <Text style={{ color: '#666', fontSize: 12 }}>Driver: {item.driverName}</Text>}
            {item.passengerName && <Text style={{ color: '#666', fontSize: 12 }}>Passenger: {item.passengerName}</Text>}
          </View>
        )}
      />
    </View>
  );
}