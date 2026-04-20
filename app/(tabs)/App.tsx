import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

const Tab = createBottomTabNavigator();

function HomeScreen() {
  return (
    <View style={styles.container}>

      {/* Search Bar */}
      <TextInput
        placeholder="Where are you going?"
        style={styles.search}
      />

      {/* Recent Places */}
      <View style={styles.list}>
        <Text style={styles.item}>JNTU College Entrance</Text>
        <Text style={styles.item}>UNIT-7</Text>
        <Text style={styles.item}>KPHB METRO</Text>
      </View>

      {/* Title */}
      <Text style={styles.title}>Everything In Minutes</Text>

      {/* Ride Options */}
      <View style={styles.row}>
        <View style={[styles.card, { backgroundColor: '#f5e6c8' }]}>
          <Text style={styles.cardText}>Bike</Text>
        </View>

        <View style={[styles.card, { backgroundColor: '#dce6f7' }]}>
          <Text style={styles.cardText}>Auto</Text>
        </View>

        <View style={[styles.card, { backgroundColor: '#eadcf5' }]}>
          <Text style={styles.cardText}>Cab</Text>
        </View>
      </View>

    </View>
  );
}

function DummyScreen({ title }: any) {
  return (
    <View style={styles.center}>
      <Text>{title}</Text>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>

        <Tab.Screen name="Ride" component={HomeScreen} />

        <Tab.Screen name="Drive">
          {() => <DummyScreen title="Driver Mode Coming Soon" />}
        </Tab.Screen>

        <Tab.Screen name="Profile">
          {() => <DummyScreen title="Profile Screen" />}
        </Tab.Screen>

      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 15,
    backgroundColor: '#fff'
  },
  search: {
    backgroundColor: '#eee',
    padding: 15,
    borderRadius: 30,
    marginBottom: 15
  },
  list: {
    marginBottom: 20
  },
  item: {
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderColor: '#ddd'
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  card: {
    width: '30%',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center'
  },
  cardText: {
    fontWeight: 'bold'
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  }
});