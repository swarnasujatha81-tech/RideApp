import React from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  message: string;
  contact: string;
  onClose: () => void;
};

export default function BlockedAccount({ visible, message, contact, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const handleCall = () => {
    const url = `tel:${contact}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Alert.alert('Call', `Please call ${contact}`);
      }
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card}>
          <Text style={styles.title}>Account Blocked</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.primary]} onPress={handleCall}>
              <Text style={styles.primaryText}>Contact Support</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.secondary]} onPress={onClose}>
              <Text style={styles.secondaryText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(4,8,18,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '92%',
    backgroundColor: '#071023',
    borderRadius: 14,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  message: {
    color: '#B9C6E3',
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  primary: {
    backgroundColor: '#FFFFFF',
  },
  secondary: {
    borderColor: '#2C3A59',
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  primaryText: {
    color: '#071023',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryText: {
    color: '#B9C6E3',
    fontWeight: '700',
    fontSize: 15,
  },
});
