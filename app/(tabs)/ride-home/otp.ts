import { decode, encode } from 'base-64';

const SECRET_KEY = process.env.EXPO_PUBLIC_OTP_SECRET_KEY || '';

export const encryptOTP = (otp: string) => encode(otp.split('').reverse().join('') + SECRET_KEY);
export const decryptOTP = (val: string) => decode(val).replace(SECRET_KEY, '').split('').reverse().join('');
export const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();
