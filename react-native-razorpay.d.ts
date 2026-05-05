declare module 'react-native-razorpay' {
  const RazorpayCheckout: {
    open(options: Record<string, unknown>, successCallback?: (data: unknown) => void, errorCallback?: (error: unknown) => void): Promise<unknown>;
    onExternalWalletSelection?(externalWalletCallback: (data: unknown) => void): void;
  };

  export default RazorpayCheckout;
}
