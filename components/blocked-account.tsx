import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  message: string;
  contact: string;
  email?: string;
  onClose?: () => void;
};

export default function BlockedAccount({ visible, message, contact, email, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const handleCall = () => {
    const url = `tel:${contact.replace(/\s/g, '')}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Alert.alert('Call', `Please call ${contact}`);
      }
    });
  };

  const handleEmail = () => {
    if (!email) return;
    const url = `mailto:${email}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Alert.alert('Email', `Please email ${email}`);
      }
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.content}>
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={30} color="#FFFFFF" />
          </View>
          <Text style={styles.title}>Account Blocked</Text>
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.contactLine}>Email: {email || 's123shareit@gmail.com'}</Text>
          <Text style={styles.contactLine}>Phone: {contact}</Text>
          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.primary]} onPress={handleCall}>
              <Text style={styles.primaryText}>Call Admin</Text>
            </Pressable>
            {!!email && (
              <Pressable style={[styles.button, styles.secondary]} onPress={handleEmail}>
                <Text style={styles.secondaryText}>Email Admin</Text>
              </Pressable>
            )}
          </View>
          {!!onClose && (
            <Pressable style={styles.closeLink} onPress={onClose}>
              <Text style={styles.closeLinkText}>Close</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#071023',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  lockBadge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B91C1C',
    marginBottom: 18,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    color: '#B9C6E3',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
    textAlign: 'center',
  },
  contactLine: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
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
  closeLink: {
    marginTop: 20,
    padding: 10,
  },
  closeLinkText: {
    color: '#94A3B8',
    fontWeight: '700',
  },
});
