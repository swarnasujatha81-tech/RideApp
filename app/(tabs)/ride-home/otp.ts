import { decode, encode } from 'base-64';

const SECRET_KEY = process.env.EXPO_PUBLIC_OTP_SECRET_KEY || 'SHARE_IT_SECURE_2026';

export const encryptOTP = (otp: string) => encode(otp.split('').reverse().join('') + SECRET_KEY);
export const decryptOTP = (val: string) => {
  try {
    return decode(val || '').replace(SECRET_KEY, '').split('').reverse().join('');
  } catch (error) {
    console.error('[otp] failed to decrypt OTP', error);
    return '';
  }
};
export const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();
