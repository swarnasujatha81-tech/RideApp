import React from 'react';
import { ActivityIndicator, Button, Modal, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { FirebaseOptions } from 'firebase/app';
import type { ApplicationVerifier } from 'firebase/auth';

type Props = {
  firebaseConfig: FirebaseOptions;
  title?: string;
  cancelLabel?: string;
  languageCode?: string;
};

type State = {
  visible: boolean;
  loaded: boolean;
  resolve?: (token: string) => void;
  reject?: (error: Error) => void;
};

function getRecaptchaSource(firebaseConfig: FirebaseOptions, languageCode?: string) {
  return {
    baseUrl: `https://${firebaseConfig.authDomain}`,
    html: `
<!DOCTYPE html><html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js"></script>
  <script type="text/javascript">firebase.initializeApp(${JSON.stringify(firebaseConfig)});</script>
  <style>
    html, body, #recaptcha-cont {
      height: 100%;
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <div id="recaptcha-cont" class="g-recaptcha"></div>
  <script>
    function post(type, token) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, token: token || null }));
    }
    function onVerify(token) {
      post('verify', token);
    }
    function onLoad() {
      post('load');
      window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-cont', {
        size: 'normal',
        callback: onVerify
      });
      window.recaptchaVerifier.render();
    }
    function onError() {
      post('error');
    }
  </script>
  <script src="https://www.google.com/recaptcha/api.js?onload=onLoad&render=explicit&hl=${languageCode ?? ''}" onerror="onError()"></script>
</body></html>`,
  };
}

export default class FirebaseRecaptchaVerifier extends React.Component<Props, State> implements ApplicationVerifier {
  state: State = {
    visible: false,
    loaded: false,
  };

  get type() {
    return 'recaptcha';
  }

  verify(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.setState({
        visible: true,
        loaded: false,
        resolve,
        reject,
      });
    });
  }

  _reset(): void {}

  private handleCancel = () => {
    const { reject } = this.state;
    reject?.(new Error('reCAPTCHA verification was cancelled.'));
    this.setState({ visible: false, loaded: false, resolve: undefined, reject: undefined });
  };

  private handleError = () => {
    const { reject } = this.state;
    reject?.(new Error('Failed to load reCAPTCHA.'));
    this.setState({ visible: false, loaded: false, resolve: undefined, reject: undefined });
  };

  private handleVerify = (token: string) => {
    const { resolve } = this.state;
    resolve?.(token);
    this.setState({ visible: false, loaded: false, resolve: undefined, reject: undefined });
  };

  render() {
    const { firebaseConfig, title = 'reCAPTCHA', cancelLabel = 'Cancel', languageCode } = this.props;
    const { visible, loaded } = this.state;

    return (
      <View style={styles.container}>
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={this.handleCancel}>
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <View style={styles.cancel}>
                <Button title={cancelLabel} onPress={this.handleCancel} />
              </View>
            </View>
            <View style={styles.content}>
              <WebView
                javaScriptEnabled
                automaticallyAdjustContentInsets
                scalesPageToFit
                mixedContentMode="always"
                source={getRecaptchaSource(firebaseConfig, languageCode)}
                onError={this.handleError}
                onMessage={(event) => {
                  try {
                    const data = JSON.parse(event.nativeEvent.data);
                    if (data.type === 'load') {
                      this.setState({ loaded: true });
                    } else if (data.type === 'error') {
                      this.handleError();
                    } else if (data.type === 'verify' && data.token) {
                      this.handleVerify(data.token);
                    }
                  } catch (error) {
                    console.error('[recaptcha] invalid WebView message', error);
                  }
                }}
              />
              {!loaded && (
                <View style={styles.loader}>
                  <ActivityIndicator size="large" />
                </View>
              )}
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    width: 0,
    height: 0,
  },
  modalContainer: {
    flex: 1,
  },
  header: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomColor: '#CECECE',
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#FBFBFB',
  },
  title: {
    fontWeight: '700',
  },
  cancel: {
    position: 'absolute',
    left: 8,
  },
  content: {
    flex: 1,
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 20,
  },
});
